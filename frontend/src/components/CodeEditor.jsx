import Editor from "@monaco-editor/react";

function CodeEditor({ code, setCode }) {
  return (
    <Editor
      height="100%"
      language="cpp"
      theme="vs-dark"
      value={code}
      onChange={(value) => setCode(value ?? "")}
      loading={<div className="editor-loading">Loading editor...</div>}
      options={{
        fontSize: 16,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 4,
      }}
    />
  );
}

export default CodeEditor;