const vscode = acquireVsCodeApi();

document.getElementById("myButton").addEventListener("click", () => {
  vscode.postMessage({
    command: "alert",
    text: "Button clicked!",
  });
});

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.command) {
    case "setText":
      const textArea = document.getElementById("documentText");
      if (textArea) {
        textArea.value = message.text;
      }
      break;
  }
});
