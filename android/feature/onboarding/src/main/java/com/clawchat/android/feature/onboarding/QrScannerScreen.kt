package com.clawchat.android.feature.onboarding

import android.Manifest
import android.util.Log
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
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Composable
fun QrScannerScreen(
    onQrScanned: (String) -> Unit,
    onCancel: () -> Unit,
    onManualEntry: () -> Unit,
) {
    var hasPermission by remember { mutableStateOf<Boolean?>(null) }
    var scanned by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasPermission = granted
    }

    LaunchedEffect(Unit) {
        permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    when (hasPermission) {
        null -> {
            Box(
                modifier = Modifier.fillMaxSize().background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Color.White)
            }
        }
        false -> {
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
        true -> {
            Box(modifier = Modifier.fillMaxSize()) {
                CameraPreview(
                    onQrDetected = { rawValue ->
                        if (!scanned) {
                            scanned = true
                            onQrScanned(rawValue)
                        }
                    },
                )

                // Overlay controls
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.BottomCenter)
                        .background(Color.Black.copy(alpha = 0.6f))
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        stringResource(R.string.onboarding_point_camera_at_qr),
                        color = Color.White,
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
        }
    }
}

@Composable
private fun CameraPreview(onQrDetected: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnQrDetected by rememberUpdatedState(onQrDetected)
    val resources = remember(context, lifecycleOwner) { CameraPreviewResources() }

    DisposableEffect(context, lifecycleOwner, resources) {
        resources.imageAnalysis.setAnalyzer(resources.executor) { imageProxy ->
            processImage(imageProxy, resources.scanner) { rawValue ->
                // ML Kit can finish after this composable has left the tree.
                // Never route a stale scan into the next onboarding step.
                if (!resources.isDisposed) currentOnQrDetected(rawValue)
            }
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
            } catch (error: Exception) {
                Log.e("QrScanner", "Camera bind failed", error)
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            // The onboarding steps share one Activity lifecycle. Binding only to
            // that owner would leave the camera running after this composable is
            // removed, so release every resource at the composition boundary.
            resources.isDisposed = true
            resources.imageAnalysis.clearAnalyzer()
            resources.cameraProvider?.unbind(resources.preview, resources.imageAnalysis)
            resources.cameraProvider = null
            resources.scanner.close()
            resources.executor.shutdown()
        }
    }

    AndroidView(
        factory = { ctx ->
            PreviewView(ctx).also { previewView ->
                resources.preview.surfaceProvider = previewView.surfaceProvider
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

private class CameraPreviewResources {
    val executor: ExecutorService = Executors.newSingleThreadExecutor()
    val scanner: BarcodeScanner = BarcodeScanning.getClient()
    val preview: Preview = Preview.Builder().build()
    val imageAnalysis: ImageAnalysis = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()

    @Volatile
    var isDisposed: Boolean = false

    @Volatile
    var cameraProvider: ProcessCameraProvider? = null
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun processImage(
    imageProxy: ImageProxy,
    scanner: BarcodeScanner,
    onQrDetected: (String) -> Unit,
) {
    val mediaImage = imageProxy.image
    if (mediaImage == null) {
        imageProxy.close()
        return
    }

    val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
    scanner.process(inputImage)
        .addOnSuccessListener { barcodes ->
            for (barcode in barcodes) {
                if (barcode.format == Barcode.FORMAT_QR_CODE) {
                    barcode.rawValue?.let { onQrDetected(it) }
                }
            }
        }
        .addOnCompleteListener {
            imageProxy.close()
        }
}
