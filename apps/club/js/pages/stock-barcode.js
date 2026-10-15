(function () {
    "use strict";
    window.Paryx = window.Paryx || {};
    const dialog = document.getElementById("stockCameraDialog");
    const video = document.getElementById("stockCameraVideo");
    const status = document.getElementById("stockCameraStatus");
    let generation = 0;
    let stream = null;
    let controls = null;
    let returnFocus = null;

    function stop() {
        generation += 1;
        if (controls) { controls.stop(); controls = null; }
        if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
        video.srcObject = null;
    }

    function close() {
        stop();
        if (dialog.open) dialog.close();
        returnFocus?.focus();
    }

    async function open(onResult) {
        stop();
        returnFocus = document.activeElement;
        const run = generation;
        status.textContent = "Starting camera...";
        dialog.showModal();
        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                throw new Error("Camera access requires HTTPS or the Paryx desktop app. Use a USB scanner or enter the barcode instead.");
            }
            if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
                throw new Error("The camera scanner could not load. Refresh, or use a USB scanner.");
            }
            const acquired = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            if (run !== generation || !dialog.open) {
                acquired.getTracks().forEach(track => track.stop());
                return;
            }
            stream = acquired;
            const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
            status.textContent = "Point the camera at one barcode.";
            const acquiredControls = await reader.decodeFromStream(stream, video, function (result) {
                if (!result || run !== generation || !dialog.open) return;
                const code = String(result.getText() || "").trim();
                if (!code || code.length > 120) {
                    status.textContent = "This code is too long for a stock barcode. Try another barcode.";
                    return;
                }
                close();
                onResult(code);
            });
            if (run !== generation) acquiredControls.stop();
            else controls = acquiredControls;
        } catch (error) {
            if (run !== generation) return;
            stop();
            const messages = {
                NotAllowedError: "Camera access was denied. Allow camera access in your browser or Windows settings, or use a USB scanner.",
                NotFoundError: "No camera was found. Connect a camera or use a USB scanner.",
                NotReadableError: "The camera is busy or unavailable. Close other apps using it and try again."
            };
            status.textContent = messages[error?.name] || error?.message || "Camera scanning could not start.";
        }
    }

    document.getElementById("stockCameraClose").addEventListener("click", close);
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    dialog.addEventListener("close", stop);
    document.addEventListener("visibilitychange", function () { if (document.hidden && dialog.open) close(); });
    window.addEventListener("pagehide", stop);
    window.Paryx.barcodeCamera = { open, close };
})();
