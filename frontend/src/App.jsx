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

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("output");

  // Save the code every time it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, code);
  }, [code]);

  const handleRun = async () => {
    setActiveTab("output");
    setIsRunning(true);
    setOutput("");
    setError("");

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      // Teammates' backend should reply with { output, error }
      setOutput(data.output ?? "");
      setError(data.error ?? "");
    } catch {
      setError(
        "Could not reach the backend at /api/execute.\n" +
          "Make sure the backend server is running."
      );
    } finally {
      setIsRunning(false);
    }
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

          <BottomPanel
            output={output}
            error={error}
            isRunning={isRunning}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        </section>

        <ProblemPanel />
      </main>
    </div>
  );
}

export default App;