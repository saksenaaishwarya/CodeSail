function Navbar() {
  return (
    <nav className="navbar">
      <div className="nav-links">
        <span className="nav-item active">IDE</span>
        <span className="nav-item">My Submissions</span>
        <span className="nav-item">Assignments</span>
        <span className="nav-item">Practice</span>
        <span className="nav-item">Progress</span>
      </div>

      <div className="nav-user">
        <span className="bell">🔔</span>
        <div className="avatar">AI</div>
        <div>
          <div className="user-name">Aishwarya</div>
          <div className="user-role">Student</div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;