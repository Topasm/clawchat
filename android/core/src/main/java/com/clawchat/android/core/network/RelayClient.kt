package com.clawchat.android.core.network

import android.util.Base64
import android.util.Log
import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.Buffer
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

data class RelayResponse(val status: Int, val contentType: String?, val body: ByteArray)

@Singleton
class RelayClient @Inject constructor(private val sessionStore: SessionStore) {
    companion object {
        private const val TAG = "RelayClient"
        private val LABEL = "clawchat-relay-v1".toByteArray()
    }

    private val httpClient = OkHttpClient()
    private val connectionMutex = Mutex()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<RelayResponse>>()
    private val receivedNonces = mutableSetOf<String>()
    private val nonceOrder = ArrayDeque<String>()
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val events: SharedFlow<String> = _events.asSharedFlow()

    @Volatile private var webSocket: WebSocket? = null
    @Volatile private var aesKey: ByteArray? = null
    @Volatile private var ready: CompletableDeferred<Unit>? = null
    @Volatile private var activeHostId: String? = null

    suspend fun ensureConnected(expectedScope: String? = null): Boolean = connectionMutex.withLock {
        val session = sessionStore.activeSession.first()
        if (expectedScope != null && session?.connectionScope() != expectedScope) {
            throw SessionScopeChangedException(expectedScope, session?.connectionScope())
        }
        // Relay pairing is host-scoped. A manual direct session can retain old
        // pairing preferences during a transition, but share work must never
        // fall back through that unrelated host.
        if (expectedScope != null && session?.authMode != "paired") {
            throw SessionScopeChangedException(expectedScope, session?.connectionScope())
        }
        val relayUrl = sessionStore.relayUrl.first() ?: return false
        val hostId = sessionStore.hostId.first() ?: return false
        val hostPublicKey = sessionStore.hostPublicKey.first() ?: return false
        if (expectedScope != null && hostId != expectedScope) {
            throw SessionScopeChangedException(expectedScope, hostId)
        }
        val latestSession = sessionStore.activeSession.first()
        if (expectedScope != null && latestSession?.connectionScope() != expectedScope) {
            throw SessionScopeChangedException(expectedScope, latestSession?.connectionScope())
        }
        if (activeHostId == hostId && ready?.isCompleted == true && webSocket != null) return true

        disconnectInternal()
        val privateKey = X25519PrivateKeyParameters(SecureRandom())
        val publicKey = privateKey.generatePublicKey().encoded
        val agreement = X25519Agreement().apply { init(privateKey) }
        val sharedSecret = ByteArray(agreement.agreementSize)
        agreement.calculateAgreement(X25519PublicKeyParameters(decode(hostPublicKey), 0), sharedSecret, 0)
        aesKey = ByteArray(32).also { derivedKey ->
            HKDFBytesGenerator(SHA256Digest()).apply {
                init(HKDFParameters(sharedSecret, hostId.toByteArray(), LABEL))
                generateBytes(derivedKey, 0, derivedKey.size)
            }
        }
        activeHostId = hostId
        val readySignal = CompletableDeferred<Unit>()
        ready = readySignal
        val wsUrl = relayUrl.replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://").trimEnd('/') + "/v1/relay/client/$hostId"
        webSocket = httpClient.newWebSocket(Request.Builder().url(wsUrl).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JSONObject().apply {
                    put("kind", "hello")
                    put("client_public_key", encode(publicKey))
                }.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) = handleFrame(text)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (this@RelayClient.webSocket === webSocket) failConnection(t)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (this@RelayClient.webSocket === webSocket) {
                    failConnection(IllegalStateException("Relay closed: $reason"))
                }
            }
        })
        try {
            withTimeout(15_000) { readySignal.await() }
            true
        } catch (error: Exception) {
            Log.w(TAG, "Relay handshake failed", error)
            disconnectInternal()
            false
        }
    }

    suspend fun subscribe(token: String): Boolean {
        if (!ensureConnected()) return false
        sendEncrypted(JSONObject().put("type", "subscribe").put("token", token))
        return true
    }

    suspend fun unsubscribe() {
        if (ready?.isCompleted == true) runCatching {
            sendEncrypted(JSONObject().put("type", "unsubscribe"))
        }
    }

    suspend fun execute(request: Request): Response {
        val expectedScope = request.tag(ExpectedSessionScope::class.java)?.value
        if (!ensureConnected(expectedScope)) throw IllegalStateException("Relay is not configured")
        val id = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<RelayResponse>()
        pending[id] = deferred
        val bodyBytes = request.body?.let { body ->
            Buffer().use { buffer -> body.writeTo(buffer); buffer.readByteArray() }
        } ?: ByteArray(0)
        val path = request.url.encodedPath + request.url.encodedQuery?.let { "?$it" }.orEmpty()
        sendEncrypted(JSONObject().apply {
            put("type", "http_request")
            put("id", id)
            put("method", request.method)
            put("path", path)
            put("headers", JSONObject().apply {
                request.header("Authorization")?.let { put("authorization", it) }
                request.header("Content-Type")?.let { put("content-type", it) }
                request.header("Accept")?.let { put("accept", it) }
            })
            put("body", encode(bodyBytes))
        })
        val relayResponse = try {
            withTimeout(120_000) { deferred.await() }
        } finally {
            pending.remove(id)
        }
        return Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
            .code(relayResponse.status).message("Relay")
            .body(relayResponse.body.toResponseBody(relayResponse.contentType?.toMediaTypeOrNull()))
            .build()
    }

    private fun sendEncrypted(payload: JSONObject) {
        val key = aesKey ?: error("Relay key is unavailable")
        val nonce = ByteArray(12).also(SecureRandom()::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(LABEL)
        val ciphertext = cipher.doFinal(payload.toString().toByteArray())
        check(webSocket?.send(JSONObject().apply {
            put("kind", "encrypted")
            put("nonce", encode(nonce))
            put("ciphertext", encode(ciphertext))
        }.toString()) == true) { "Relay send failed" }
    }

    private fun handleFrame(text: String) {
        try {
            val frame = JSONObject(text)
            if (frame.optString("kind") == "host_offline") error("Host is offline")
            if (frame.optString("kind") != "encrypted") return
            val nonceValue = frame.getString("nonce")
            synchronized(receivedNonces) {
                check(nonceValue !in receivedNonces) { "Relay frame was replayed" }
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey ?: return, "AES"),
                GCMParameterSpec(128, decode(nonceValue)))
            cipher.updateAAD(LABEL)
            val payload = JSONObject(String(cipher.doFinal(decode(frame.getString("ciphertext")))))
            synchronized(receivedNonces) {
                receivedNonces.add(nonceValue)
                nonceOrder.addLast(nonceValue)
                if (nonceOrder.size > 2048) receivedNonces.remove(nonceOrder.removeFirst())
            }
            when (payload.optString("type")) {
                "ready" -> {
                    check(payload.getString("host_id") == activeHostId) { "Relay host mismatch" }
                    ready?.complete(Unit)
                }
                "http_response" -> pending[payload.getString("id")]?.complete(RelayResponse(
                    payload.getInt("status"),
                    payload.optJSONObject("headers")?.optString("content-type"),
                    decode(payload.optString("body")),
                ))
                "event" -> payload.optJSONObject("data")?.let { _events.tryEmit(it.toString()) }
                "auth_error" -> _events.tryEmit("""{"type":"auth_error"}""")
            }
        } catch (error: Exception) {
            failConnection(error)
        }
    }

    private fun failConnection(error: Throwable) {
        ready?.completeExceptionally(error)
        pending.values.forEach { it.completeExceptionally(error) }
        pending.clear()
        _events.tryEmit("""{"type":"relay_disconnected"}""")
        webSocket = null
    }

    private fun disconnectInternal() {
        webSocket?.close(1000, "Reconnect")
        webSocket = null
        aesKey = null
        ready = null
        activeHostId = null
        synchronized(receivedNonces) {
            receivedNonces.clear()
            nonceOrder.clear()
        }
    }

    private fun encode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun decode(value: String): ByteArray =
        Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun ActiveSession.connectionScope(): String? = when (authMode) {
        "paired" -> hostId
        "manual" -> apiBaseUrl?.trimEnd('/')
        else -> hostId ?: apiBaseUrl?.trimEnd('/')
    }
}
