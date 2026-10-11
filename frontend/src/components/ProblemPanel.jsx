// Sample problem so you can see the design. Later this can come from a backend.
const PROBLEM = {
  title: "1. Prime Check",
  difficulty: "EASY",
  description:
    "Given an integer n, determine whether it is a prime number or not.",
  inputFormat: "A single integer n.",
  constraints: "1 ≤ n ≤ 10^9",
};

function ProblemPanel() {
  return (
    <aside className="panel problem-panel">
      <h3 className="problem-title">{PROBLEM.title}</h3>

      <span className="badge badge-green">{PROBLEM.difficulty}</span>

      <p className="problem-text">{PROBLEM.description}</p>

      <h4 className="problem-heading">Input Format</h4>
      <p className="problem-muted">{PROBLEM.inputFormat}</p>

      <h4 className="problem-heading">Constraints</h4>
      <p className="problem-code">{PROBLEM.constraints}</p>
    </aside>
  );
}

export default ProblemPanel;