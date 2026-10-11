import { useState } from "react";

// Sample data so you can see the design. Teammates will replace it with real results.
const SAMPLE_TESTS = [
  { id: 1, name: "Case 1", input: "n = 7", expected: "True", output: "True", passed: true },
  { id: 2, name: "Case 2", input: "n = 10", expected: "False", output: "False", passed: true },
  { id: 3, name: "Case 3", input: "n = 13", expected: "True", output: "True", passed: true },
  { id: 4, name: "Case 4", input: "n = 1", expected: "False", output: "True", passed: false },
];

function BottomPanel({ output, error }) {
  const [activeTab, setActiveTab] = useState("tests");

  const passedCount = SAMPLE_TESTS.filter((t) => t.passed).length;
  const total = SAMPLE_TESTS.length;
  const percent = (passedCount / total) * 100;

  return (
    <div className="panel bottom-panel">
      <div className="tabs-row">
        <div className="tabs">
          <button
            className={activeTab === "tests" ? "tab active" : "tab"}
            onClick={() => setActiveTab("tests")}
          >
            Test Results
          </button>
          <button
            className={activeTab === "terminal" ? "tab active" : "tab"}
            onClick={() => setActiveTab("terminal")}
          >
            Terminal
          </button>
        </div>

        {activeTab === "tests" && (
          <span className="badge badge-yellow">
            PASSED: {passedCount}/{total}
          </span>
        )}
      </div>

      {activeTab === "tests" && (
        <div className="tab-content">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }}></div>
          </div>

          <table className="results-table">
            <thead>
              <tr>
                <th>Test Case</th>
                <th>Input</th>
                <th>Expected</th>
                <th>Output</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_TESTS.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="mono">{t.input}</td>
                  <td className="mono">{t.expected}</td>
                  <td className={t.passed ? "mono" : "mono bad"}>{t.output}</td>
                  <td>
                    <span className={t.passed ? "badge badge-green" : "badge badge-red"}>
                      {t.passed ? "PASSED" : "FAILED"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "terminal" && (
        <div className="tab-content">
          <pre className="terminal">
            {error ? error : output ? output : "Output will appear here..."}
          </pre>
        </div>
      )}
    </div>
  );
}

export default BottomPanel;