function AppErrorStack({ messages = [] }) {
  return messages
    .filter(Boolean)
    .map((message, index) => (
      <div className="error-box" key={`${index}-${message}`}>
        {message}
      </div>
    ));
}

export default AppErrorStack;
