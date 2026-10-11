import { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import EditorToolbar from "./components/EditorToolbar";
import CodeEditor from "./components/CodeEditor";
import BottomPanel from "./components/BottomPanel";
import ProblemPanel from "./components/ProblemPanel";
import { CPP_STARTER_CODE } from "./constants/starterCode";
import "./App.css";

const STORAGE_KEY = "cpp-ide-code";

function App() {
  // Start with saved code if it exists, otherwise the starter code
  const [code, setCode] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? CPP_STARTER_CODE
  );

  // Teammate 2 will replace these placeholders with real logic
  const [isRunning] = useState(false);
  const [output] = useState("");
  const [error] = useState("");

  // Save the code every time it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, code);
  }, [code]);

  const handleRun = () => {
    console.log("Run clicked. Code to execute:", code);
  };
  const handleSubmit = () => {
    console.log("Submit clicked");
  };
  const handleReset = () => {
    setCode(CPP_STARTER_CODE);
  };

  return (
    <div className="app">
      <Navbar />

      <main className="workspace">
        <Sidebar />

        <section className="center">
          <div className="panel editor-panel">
            <EditorToolbar
              fileName="main.cpp"
              onRun={handleRun}
              onSubmit={handleSubmit}
              onReset={handleReset}
              isRunning={isRunning}
            />
            <div className="editor-wrap">
              <CodeEditor code={code} setCode={setCode} />
            </div>
          </div>

          <BottomPanel output={output} error={error} />
        </section>

        <ProblemPanel />
      </main>
    </div>
  );
}

export default App;