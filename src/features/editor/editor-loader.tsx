"use client";

import dynamic from "next/dynamic";
import type { BranchEditorProps } from "@/features/editor/branch-editor";

/**
 * The editor reads local drafts from localStorage while it initializes, so it renders
 * only in the browser. The server page still renders the branch heading and navigation.
 */
const BranchEditor = dynamic(
  () =>
    import("@/features/editor/branch-editor").then(
      (module) => module.BranchEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="editor-loading" aria-busy="true" />,
  },
);

export function EditorLoader(props: BranchEditorProps) {
  return <BranchEditor {...props} />;
}
