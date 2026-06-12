/**
 * ComfyUI-Sharp - Gaussian Splat Preview Widget
 * Interactive viewer with IMAGE output via auto-capture to temp
 */

import { app } from "../../../scripts/app.js";

const EXTENSION_FOLDER = (() => {
    const url = import.meta.url;
    const match = url.match(/\/extensions\/([^/]+)\//);
    return match ? match[1] : "ComfyUI-Sharp";
})();

console.log("[Sharp Gaussian] Loading extension...");

app.registerExtension({
    name: "sharp.gaussianpreview",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "SharpPreviewGaussian") {
            return;
        }

        console.log("[Sharp Gaussian] Registering Preview Gaussian (SHARP) node");

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "100%";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.backgroundColor = "#1a1a1a";
            container.style.overflow = "hidden";

            const iframe = document.createElement("iframe");
            iframe.style.width = "100%";
            iframe.style.flex = "1 1 0";
            iframe.style.minHeight = "0";
            iframe.style.border = "none";
            iframe.style.backgroundColor = "#1a1a1a";
            iframe.src = `/extensions/${EXTENSION_FOLDER}/viewer_gaussian_sharp.html?v=` + Date.now();

            const infoPanel = document.createElement("div");
            infoPanel.style.backgroundColor = "#1a1a1a";
            infoPanel.style.borderTop = "1px solid #444";
            infoPanel.style.padding = "6px 12px";
            infoPanel.style.fontSize = "10px";
            infoPanel.style.fontFamily = "monospace";
            infoPanel.style.color = "#ccc";
            infoPanel.style.lineHeight = "1.3";
            infoPanel.style.flexShrink = "0";
            infoPanel.style.overflow = "hidden";
            infoPanel.innerHTML =
                '<span style="color: #888;">Gaussian splat preview — IMAGE output updates after each queue run</span>';

            container.appendChild(iframe);
            container.appendChild(infoPanel);

            const widget = this.addDOMWidget("preview_gaussian_sharp", "GAUSSIAN_PREVIEW_SHARP", container, {
                getValue() { return ""; },
                setValue() { },
            });

            const node = this;
            let currentNodeSize = [512, 580];
            let captureFilename = "sharp_gaussian_capture.png";

            widget.computeSize = () => currentNodeSize;

            this.gaussianViewerIframe = iframe;
            this.gaussianInfoPanel = infoPanel;

            this.resizeToAspectRatio = function(imageWidth, imageHeight) {
                const aspectRatio = imageWidth / imageHeight;
                const nodeWidth = 512;
                const viewerHeight = Math.round(nodeWidth / aspectRatio);
                const nodeHeight = viewerHeight + 60;

                currentNodeSize = [nodeWidth, nodeHeight];
                node.setSize(currentNodeSize);
                node.setDirtyCanvas(true, true);
                app.graph.setDirtyCanvas(true, true);
            };

            let iframeLoaded = false;
            iframe.addEventListener("load", () => {
                iframeLoaded = true;
            });

            const uploadCapture = async (dataUrl) => {
                const base64Data = dataUrl.split(",")[1];
                const byteString = atob(base64Data);
                const arrayBuffer = new ArrayBuffer(byteString.length);
                const uint8Array = new Uint8Array(arrayBuffer);

                for (let i = 0; i < byteString.length; i++) {
                    uint8Array[i] = byteString.charCodeAt(i);
                }

                const blob = new Blob([uint8Array], { type: "image/png" });
                const formData = new FormData();
                formData.append("image", blob, captureFilename);
                formData.append("type", "temp");
                formData.append("subfolder", "");
                formData.append("overwrite", "true");

                const response = await fetch("/upload/image", {
                    method: "POST",
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error(`Upload failed: ${response.status}`);
                }

                const result = await response.json();
                console.log("[Sharp Gaussian] Capture saved to temp:", result.name || captureFilename);
            };

            window.addEventListener("message", async (event) => {
                if (event.source !== iframe.contentWindow) {
                    return;
                }

                if (event.data.type === "AUTO_CAPTURE" && event.data.image) {
                    try {
                        await uploadCapture(event.data.image);
                        if (infoPanel) {
                            const captureStatus = infoPanel.querySelector("[data-capture-status]");
                            if (captureStatus) {
                                captureStatus.textContent = "Capture saved — queue to update IMAGE";
                                captureStatus.style.color = "#8c8";
                            }
                        }
                    } catch (error) {
                        console.error("[Sharp Gaussian] Error saving auto-capture:", error);
                    }
                } else if (event.data.type === "SCREENSHOT" && event.data.image) {
                    try {
                        const base64Data = event.data.image.split(",")[1];
                        const byteString = atob(base64Data);
                        const arrayBuffer = new ArrayBuffer(byteString.length);
                        const uint8Array = new Uint8Array(arrayBuffer);
                        for (let i = 0; i < byteString.length; i++) {
                            uint8Array[i] = byteString.charCodeAt(i);
                        }
                        const blob = new Blob([uint8Array], { type: "image/png" });
                        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                        const filename = `gaussian-screenshot-${timestamp}.png`;
                        const formData = new FormData();
                        formData.append("image", blob, filename);
                        formData.append("type", "output");
                        formData.append("subfolder", "");
                        const response = await fetch("/upload/image", { method: "POST", body: formData });
                        if (response.ok) {
                            const result = await response.json();
                            console.log("[Sharp Gaussian] Screenshot saved:", result.name);
                        }
                    } catch (error) {
                        console.error("[Sharp Gaussian] Error saving screenshot:", error);
                    }
                } else if (event.data.type === "COPY_IMAGE" && event.data.success) {
                    console.log("[Sharp Gaussian] Image copied to clipboard");
                } else if (event.data.type === "COPY_IMAGE" && !event.data.success) {
                    console.error("[Sharp Gaussian] Copy failed:", event.data.error);
                } else if (event.data.type === "MESH_ERROR" && event.data.error) {
                    console.error("[Sharp Gaussian] Viewer error:", event.data.error);
                    if (infoPanel) {
                        infoPanel.innerHTML = `<div style="color: #ff6b6b;">Error: ${event.data.error}</div>`;
                    }
                } else if (event.data.type === "BG_COLOR_CHANGED") {
                    // Picker was committed by the user — sync value back to the
                    // background_color widget so the workflow serialises it correctly.
                    const bgWidget = node.widgets?.find(w => w.name === "background_color");
                    if (bgWidget) {
                        bgWidget.value = event.data.color;
                    }
                } else if (event.data.type === "CAMERA_MOVED") {
                    // Auto-capture already fired inside the iframe; update the status
                    // label so the user knows a new IMAGE will be available next queue.
                    if (infoPanel) {
                        const captureStatus = infoPanel.querySelector("[data-capture-status]");
                        if (captureStatus) {
                            captureStatus.textContent = "Camera moved — queue to update IMAGE";
                            captureStatus.style.color = "#fca";
                        }
                    }
                }
            });

            this.setSize([512, 580]);

            const onExecuted = this.onExecuted;
            this.onExecuted = function(message) {
                onExecuted?.apply(this, arguments);

                if (message?.error && message.error[0]) {
                    infoPanel.innerHTML = `<div style="color: #ff6b6b;">Error: ${message.error[0]}</div>`;
                    return;
                }

                if (!message?.ply_file?.[0]) {
                    return;
                }

                const filename = message.ply_file[0];
                const displayName = message.filename?.[0] || filename;
                const fileSizeMb = message.file_size_mb?.[0] || "N/A";
                const extrinsics = message.extrinsics?.[0] || null;
                const intrinsics = message.intrinsics?.[0] || null;
                const backgroundColor = message.background_color?.[0] || "#000000";

                if (message.capture_filename?.[0]) {
                    captureFilename = message.capture_filename[0];
                }

                if (intrinsics?.[0] && intrinsics?.[1]) {
                    const imageWidth = intrinsics[0][2] * 2;
                    const imageHeight = intrinsics[1][2] * 2;
                    this.resizeToAspectRatio(imageWidth, imageHeight);
                }

                infoPanel.innerHTML = `
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;">
                        <span style="color: #888;">File:</span>
                        <span style="color: #6cc;">${displayName}</span>
                        <span style="color: #888;">Size:</span>
                        <span>${fileSizeMb} MB</span>
                        <span style="color: #888;">Capture:</span>
                        <span data-capture-status style="color: #8c8;">pending…</span>
                    </div>
                `;

                let filepath;
                const normalized = filename.replace(/\\/g, "/");
                const pathMatch = normalized.match(/(?:^|\/)(output|input|temp)\/(.+)$/);
                if (pathMatch) {
                    const [, type, relPath] = pathMatch;
                    const parts = relPath.split("/");
                    const fname = parts.pop();
                    const subfolder = parts.join("/");
                    filepath = `/view?filename=${encodeURIComponent(fname)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`;
                } else {
                    const basename = normalized.split("/").pop();
                    filepath = `/view?filename=${encodeURIComponent(basename)}&type=output&subfolder=`;
                }

                const sendUrl = () => {
                    if (!iframe.contentWindow) {
                        console.error("[Sharp Gaussian] Iframe not ready");
                        return;
                    }
                    iframe.contentWindow.postMessage({
                        type: "LOAD_MESH_URL",
                        url: filepath,
                        filename: filename,
                        extrinsics: extrinsics,
                        intrinsics: intrinsics,
                        background_color: backgroundColor,
                        timestamp: Date.now(),
                    }, "*");
                };

                if (iframeLoaded) {
                    sendUrl();
                } else {
                    setTimeout(sendUrl, 500);
                }
            };

            return r;
        };
    },
});
