import type { RecognitionSuccess } from "@photo-to-chess/contract";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { recognizeImage } from "../recognition/api";
import { cornersCanHelp, photosEnabled, type Corner, type Corners } from "../recognition/corners";
import { ACCEPT_ATTRIBUTE, ImageProblem, prepareImage } from "../recognition/prepareImage";
import { CameraCapture } from "./CameraCapture";
import { CornerPicker } from "./CornerPicker";

/** An image ready to send, and a link to show it. */
type Prepared = { image: Blob; previewUrl: string };

type Stage =
  | { kind: "idle" }
  | { kind: "camera" }
  | { kind: "corners"; prepared: Prepared }
  | { kind: "reading"; previewUrl: string }
  | { kind: "problem"; message: string; previewUrl: string | null; photo?: Prepared };

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

  const photos = photosEnabled();

  /** Reads a prepared image: as a screenshot, or as a photo when corners are given. */
  const send = useCallback(
    async (prepared: Prepared, corners?: Corners, white?: Corner) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setStage({ kind: "reading", previewUrl: prepared.previewUrl });
      const result = await recognizeImage(prepared.image, controller.signal, corners, white);
      if (controller.signal.aborted) return;
      if (result.status === "ok") {
        onRecognized(result);
        return;
      }
      // The screenshot reader doesn't find real boards, so offer to mark the corners instead.
      const offerCorners = photos && !corners && cornersCanHelp(result.code);
      setStage({
        kind: "problem",
        message: result.message,
        previewUrl: prepared.previewUrl,
        photo: offerCorners ? prepared : undefined,
      });
    },
    [onRecognized, photos],
  );

  /** Checks and shrinks an image, then reads it, or asks for the board's corners first. */
  const read = useCallback(
    async (image: Blob, markCorners = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const url = URL.createObjectURL(image);
      replacePreview(url);
      setStage({ kind: "reading", previewUrl: url });
      let prepared: Blob;
      try {
        prepared = await prepareImage(image);
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ImageProblem ? error.message : "This image couldn't be read. Try another one.";
        setStage({ kind: "problem", message, previewUrl: url });
        return;
      }
      if (controller.signal.aborted) return;
      // Corners are marked on the image that will be sent, so they match what the service sees.
      let shownUrl = url;
      if (prepared !== image) {
        shownUrl = URL.createObjectURL(prepared);
        replacePreview(shownUrl);
      }
      const ready = { image: prepared, previewUrl: shownUrl };
      if (markCorners) setStage({ kind: "corners", prepared: ready });
      else await send(ready);
    },
    [replacePreview, send],
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
        {/* A camera shows a real board, so with photos on, its corners are marked straight away. */}
        <CameraCapture onCapture={(image) => void read(image, photos)} onClose={() => setStage({ kind: "idle" })} />
      </main>
    );
  }

  if (stage.kind === "corners") {
    const { prepared } = stage;
    return (
      <main className="input">
        <CornerPicker
          imageUrl={prepared.previewUrl}
          onSubmit={(corners, white) => void send(prepared, corners, white)}
          onCancel={reset}
        />
      </main>
    );
  }

  return (
    <main className="input">
      <h1 className="input__title">Diss Chess</h1>

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
            {stage.photo && (
              <button
                type="button"
                className="primary"
                onClick={() => stage.photo && setStage({ kind: "corners", prepared: stage.photo })}
              >
                Mark the corners of a real board
              </button>
            )}
            <button type="button" className={stage.photo ? undefined : "primary"} onClick={reset}>
              Try another image
            </button>
          </div>
        </div>
      )}

      <button type="button" className="text-button" onClick={onArrangeByHand}>
        Arrange a position by hand
      </button>
    </main>
  );
}
