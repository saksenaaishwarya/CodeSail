function EditorToolbar({ fileName, onRun, onSubmit, onReset, isRunning }) {
  return (
    <div className="toolbar">
      <div className="file-tab">{fileName}</div>

      <div className="toolbar-actions">
        <div className="lang-select">C++ 17</div>

        <button className="btn btn-reset" onClick={onReset}>
          ↺ Reset
        </button>

        <button className="btn btn-run" onClick={onRun} disabled={isRunning}>
          ▷ {isRunning ? "Running..." : "Run Code"}
        </button>

        <button className="btn btn-submit" onClick={onSubmit}>
          ☁ Submit
        </button>
      </div>
    </div>
  );
}

export default EditorToolbar;