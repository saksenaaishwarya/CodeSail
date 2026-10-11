const FILES = ["main.cpp", "utils.h", "test_main.cpp"];

function Sidebar() {
  const activeFile = "main.cpp";

  return (
    <aside className="panel sidebar">
      <div className="sidebar-header">
        <h3>Project Files</h3>
        <button className="new-file-btn">+ New File</button>
      </div>

      <ul className="file-list">
        {FILES.map((name) => (
          <li
            key={name}
            className={name === activeFile ? "file-item active" : "file-item"}
          >
            📄 {name}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default Sidebar;