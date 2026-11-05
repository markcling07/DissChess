import type { RecognitionSuccess } from "@photo-to-chess/contract";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { recognizeImage } from "../recognition/api";
import { ACCEPT_ATTRIBUTE, ImageProblem, prepareImage } from "../recognition/prepareImage";
import { CameraCapture } from "./CameraCapture";

type Stage =
  | { kind: "idle" }
  | { kind: "camera" }
  | { kind: "reading"; previewUrl: string }
  | { kind: "problem"; message: string; previewUrl: string | null };

export function InputScreen({
  onRecognized,
  onArrangeByHand,
}: {
  onRecognized: (result: RecognitionSuccess) => void;
  onArrangeByHand: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | null>(null);

  const replacePreview = useCallback((url: string | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = url;
  }, []);

  useEffect(
    () => () => {
      request.current?.abort();
      replacePreview(null);
    },
    [replacePreview],
  );

  const read = useCallback(
    async (image: Blob) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const url = URL.createObjectURL(image);
      replacePreview(url);
      setStage({ kind: "reading", previewUrl: url });

      try {
        const prepared = await prepareImage(image);
        const result = await recognizeImage(prepared, controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === "ok") onRecognized(result);
        else setStage({ kind: "problem", message: result.message, previewUrl: url });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ImageProblem ? error.message : "This image couldn't be read. Try another one.";
        setStage({ kind: "problem", message, previewUrl: url });
      }
    },
    [onRecognized, replacePreview],
  );

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void read(file);
      } else if (event.clipboardData?.types.includes("Files") || !event.clipboardData?.getData("text")) {
        setStage({ kind: "problem", message: "There's no image on your clipboard. Copy one and try again.", previewUrl: null });
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [read]);

  async function pasteFromButton() {
    if (!navigator.clipboard?.read) {
      setStage({ kind: "problem", message: "Press Ctrl+V or ⌘V to paste an image.", previewUrl: null });
      return;
    }
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((entry) => entry.startsWith("image/"));
        if (type) {
          void read(await item.getType(type));
          return;
        }
      }
      setStage({ kind: "problem", message: "There's no image on your clipboard. Copy one and try again.", previewUrl: null });
    } catch {
      setStage({ kind: "problem", message: "Your browser blocked access to the clipboard. Press Ctrl+V or ⌘V instead.", previewUrl: null });
    }
  }

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void read(file);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  }

  function reset() {
    request.current?.abort();
    replacePreview(null);
    setStage({ kind: "idle" });
  }

  if (stage.kind === "camera") {
    return (
      <main className="input">
        <CameraCapture onCapture={(image) => void read(image)} onClose={() => setStage({ kind: "idle" })} />
      </main>
    );
  }

  return (
    <main className="input">
      <h1 className="input__title">Photo to Chess</h1>
      <p className="lede">Turn a screenshot of a chessboard into a game you can play.</p>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Image file"
        onChange={onFileChosen}
      />

      {stage.kind === "idle" && (
        <div
          className={dragging ? "dropzone dropzone--active" : "dropzone"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="dropzone__actions">
            <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
              Upload image
            </button>
            <button type="button" className="on-board" onClick={() => setStage({ kind: "camera" })}>
              Open camera
            </button>
            <button type="button" className="on-board" onClick={() => void pasteFromButton()}>
              Paste image
            </button>
          </div>
          <p className="dropzone__hint">Or drop an image here, or press Ctrl+V. JPG, PNG or WEBP, up to 15 MB.</p>
        </div>
      )}

      {stage.kind === "reading" && (
        <div className="reading">
          <img className="reading__image" src={stage.previewUrl} alt="The image being read" />
          <p className="reading__status" role="status">
            Reading the board…
          </p>
          <div className="reading__bar" aria-hidden="true" />
          <div className="actions">
            <button type="button" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage.kind === "problem" && (
        <div className="reading">
          {stage.previewUrl && <img className="reading__image" src={stage.previewUrl} alt="The image you chose" />}
          <p className="input__problem" role="alert">
            {stage.message}
          </p>
          <div className="actions">
            <button type="button" className="primary" onClick={reset}>
              Try another image
            </button>
          </div>
        </div>
      )}

      <p className="input__note">
        Works with screenshots of digital boards. Photos of real boards aren't supported yet. Images are read
        once and not stored.
      </p>
      <button type="button" className="text-button" onClick={onArrangeByHand}>
        Arrange a position by hand
      </button>
    </main>
  );
}
