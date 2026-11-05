import { useEffect, useRef, useState } from "react";

function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return "Camera access is turned off for this site. Allow it in your browser settings, or upload an image instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device. Upload an image instead.";
  }
  if (name === "NotReadableError") {
    return "Another app is using the camera. Close it and try again, or upload an image instead.";
  }
  return "The camera couldn't start. Upload an image instead.";
}

/** A live camera view. The camera turns off as soon as this closes. */
export function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (image: Blob) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        // Browsers only offer the camera on HTTPS or localhost.
        setProblem("The camera needs a secure (HTTPS) connection. Upload an image instead.");
        return;
      }
      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        if (video.current) {
          video.current.srcObject = opened;
          await video.current.play();
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) setProblem(cameraProblem(error));
      }
    }

    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function capture() {
    const element = video.current;
    if (!element) return;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")!.drawImage(element, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
        else setProblem("The photo couldn't be taken. Try again.");
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Camera">
      {problem ? (
        <p className="camera__problem" role="alert">
          {problem}
        </p>
      ) : (
        <video ref={video} className="camera__video" playsInline muted aria-label="Camera view" />
      )}
      <div className="actions">
        {!problem && (
          <button type="button" className="primary" disabled={!ready} onClick={capture}>
            Take photo
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close camera
        </button>
      </div>
    </div>
  );
}
