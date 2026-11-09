import { useCallback, useRef, useState } from "react";
import type { EditorColumn, RawExtraction } from "@/domain/types";
import { createInitialState, redo, undo, type CommandResult, type EditorState } from "./engine";

export interface Selection {
  documentId: string;
  columnId: string;
}

/** React binding for the pure editor engine. All mutations go through `run`. */
export function useEditor(raw: RawExtraction, columns: EditorColumn[]) {
  const [state, setState] = useState<EditorState>(() => createInitialState(raw, columns));
  const ref = useRef(state);
  ref.current = state;

  const run = useCallback((fn: (s: EditorState) => CommandResult): CommandResult => {
    const r = fn(ref.current);
    ref.current = r.state;
    setState(r.state);
    return r;
  }, []);

  const doUndo = useCallback(() => {
    const had = ref.current.past.length > 0;
    const s = undo(ref.current);
    ref.current = s;
    setState(s);
    return had;
  }, []);
  const doRedo = useCallback(() => {
    const had = ref.current.future.length > 0;
    const s = redo(ref.current);
    ref.current = s;
    setState(s);
    return had;
  }, []);

  return { state, run, undo: doUndo, redo: doRedo };
}
