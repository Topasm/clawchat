package com.clawchat.android.feature.onboarding

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.widget.FrameLayout
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val QR_SCANNER_LOG_TAG = "QrScanner"

@Composable
fun QrScannerScreen(
    onQrScanned: (String) -> Boolean,
    onCancel: () -> Unit,
    onManualEntry: () -> Unit,
) {
    val context = LocalContext.current
    var hasPermission by remember {
        val alreadyGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        mutableStateOf<Boolean?>(if (alreadyGranted) true else null)
    }
    var scanned by remember { mutableStateOf(false) }
    var invalidQr by remember { mutableStateOf(false) }
    var cameraFailed by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasPermission = granted
    }

    LaunchedEffect(Unit) {
        if (hasPermission != true) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    when {
        hasPermission == null -> CameraLoadingContent()
        hasPermission == false -> CameraPermissionContent(
            onManualEntry = onManualEntry,
            onCancel = onCancel,
        )
        cameraFailed -> CameraFailureContent(
            onRetry = {
                cameraFailed = false
                scanned = false
                invalidQr = false
            },
            onManualEntry = onManualEntry,
            onCancel = onCancel,
        )
        else -> {
            Box(modifier = Modifier.fillMaxSize()) {
                CameraPreview(
                    onQrDetected = { rawValue ->
                        if (!scanned) {
                            onQrScanned(rawValue).also { accepted ->
                                scanned = accepted
                                invalidQr = !accepted
                            }
                        }
                    },
                    onCameraError = { cameraFailed = true },
                )

                ScannerControls(
                    invalidQr = invalidQr,
                    onCancel = onCancel,
                    onManualEntry = onManualEntry,
                )
            }
        }
    }
}

@Composable
private fun CameraLoadingContent() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = Color.White)
    }
}

@Composable
private fun CameraPermissionContent(
    onManualEntry: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.onboarding_camera_permission_required),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onManualEntry,
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(stringResource(R.string.onboarding_connect_manually))
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(stringResource(R.string.onboarding_cancel))
        }
    }
}

@Composable
private fun CameraFailureContent(
    onRetry: () -> Unit,
    onManualEntry: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.onboarding_camera_unavailable),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onRetry,
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(stringResource(R.string.onboarding_retry_camera))
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = onManualEntry,
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(stringResource(R.string.onboarding_connect_manually))
        }
        TextButton(onClick = onCancel) {
            Text(stringResource(R.string.onboarding_cancel))
        }
    }
}

@Composable
private fun BoxScope.ScannerControls(
    invalidQr: Boolean,
    onCancel: () -> Unit,
    onManualEntry: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .align(Alignment.BottomCenter)
            .background(Color.Black.copy(alpha = 0.6f))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(
                if (invalidQr) R.string.onboarding_invalid_qr
                else R.string.onboarding_point_camera_at_qr,
            ),
            color = if (invalidQr) MaterialTheme.colorScheme.errorContainer else Color.White,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            TextButton(onClick = onCancel) {
                Text(stringResource(R.string.onboarding_cancel), color = Color.White)
            }
            TextButton(onClick = onManualEntry) {
                Text(
                    stringResource(R.string.onboarding_enter_code_manually),
                    color = Color.White,
                )
            }
        }
    }
}

@Composable
private fun CameraPreview(
    onQrDetected: (String) -> Unit,
    onCameraError: (Throwable) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnQrDetected by rememberUpdatedState(onQrDetected)
    val currentOnCameraError by rememberUpdatedState(onCameraError)
    val mainExecutor = remember(context) { ContextCompat.getMainExecutor(context) }
    val resourceResult = remember { runCatching(CameraPreviewResources::create) }
    val resources = resourceResult.getOrNull()

    if (resources == null) {
        val error = resourceResult.exceptionOrNull() ?: IllegalStateException("Camera initialization failed")
        LaunchedEffect(error) {
            Log.e(QR_SCANNER_LOG_TAG, "Camera resources initialization failed", error)
            currentOnCameraError(error)
        }
        CameraLoadingContent()
        return
    }

    val reportFailure: (Throwable) -> Unit = { error ->
        Log.e(QR_SCANNER_LOG_TAG, "Camera operation failed", error)
        if (!resources.isDisposed && resources.failureReported.compareAndSet(false, true)) {
            mainExecutor.execute {
                if (!resources.isDisposed) currentOnCameraError(error)
            }
        }
    }

    DisposableEffect(context, lifecycleOwner, resources) {
        try {
            resources.imageAnalysis.setAnalyzer(resources.executor) { imageProxy ->
                processImage(
                    imageProxy = imageProxy,
                    scanner = resources.scanner,
                    onQrDetected = { rawValue ->
                        mainExecutor.execute {
                            if (!resources.isDisposed) currentOnQrDetected(rawValue)
                        }
                    },
                    onError = reportFailure,
                )
            }

            val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
            cameraProviderFuture.addListener({
                if (resources.isDisposed) return@addListener
                try {
                    val cameraProvider = cameraProviderFuture.get()
                    if (resources.isDisposed) return@addListener
                    resources.cameraProvider = cameraProvider
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        resources.preview,
                        resources.imageAnalysis,
                    )
                } catch (error: Throwable) {
                    reportFailure(error)
                }
            }, mainExecutor)
        } catch (error: Throwable) {
            reportFailure(error)
        }

        onDispose {
            resources.isDisposed = true
            runCatching { resources.imageAnalysis.clearAnalyzer() }
                .onFailure { Log.w(QR_SCANNER_LOG_TAG, "Could not clear camera analyzer", it) }
            runCatching {
                resources.cameraProvider?.unbind(resources.preview, resources.imageAnalysis)
            }.onFailure { Log.w(QR_SCANNER_LOG_TAG, "Could not unbind camera", it) }
            resources.cameraProvider = null
            runCatching { resources.scanner.close() }
                .onFailure { Log.w(QR_SCANNER_LOG_TAG, "Could not close barcode scanner", it) }
            runCatching { resources.executor.shutdown() }
                .onFailure { Log.w(QR_SCANNER_LOG_TAG, "Could not stop camera executor", it) }
        }
    }

    AndroidView(
        factory = { ctx ->
            try {
                PreviewView(ctx).also { previewView ->
                    resources.preview.surfaceProvider = previewView.surfaceProvider
                }
            } catch (error: Throwable) {
                reportFailure(error)
                FrameLayout(ctx)
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

private class CameraPreviewResources private constructor(
    val executor: ExecutorService,
    val scanner: BarcodeScanner,
    val preview: Preview,
    val imageAnalysis: ImageAnalysis,
) {
    val failureReported = AtomicBoolean(false)

    @Volatile
    var isDisposed: Boolean = false

    @Volatile
    var cameraProvider: ProcessCameraProvider? = null

    companion object {
        fun create(): CameraPreviewResources {
            val executor = Executors.newSingleThreadExecutor()
            var scanner: BarcodeScanner? = null
            try {
                val options = BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                    .build()
                scanner = BarcodeScanning.getClient(options)
                return CameraPreviewResources(
                    executor = executor,
                    scanner = scanner,
                    preview = Preview.Builder().build(),
                    imageAnalysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build(),
                )
            } catch (error: Throwable) {
                runCatching { scanner?.close() }
                executor.shutdown()
                throw error
            }
        }
    }
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun processImage(
    imageProxy: ImageProxy,
    scanner: BarcodeScanner,
    onQrDetected: (String) -> Unit,
    onError: (Throwable) -> Unit,
) {
    try {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.closeSafely()
            return
        }

        val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        scanner.process(inputImage)
            .addOnSuccessListener { barcodes ->
                try {
                    barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
                        ?.rawValue
                        ?.let(onQrDetected)
                } catch (error: Throwable) {
                    onError(error)
                }
            }
            .addOnFailureListener(onError)
            .addOnCompleteListener { imageProxy.closeSafely() }
    } catch (error: Throwable) {
        imageProxy.closeSafely()
        onError(error)
    }
}

private fun ImageProxy.closeSafely() {
    runCatching { close() }
        .onFailure { Log.w(QR_SCANNER_LOG_TAG, "Could not close camera frame", it) }
}
