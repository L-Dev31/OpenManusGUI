document.addEventListener("DOMContentLoaded", () => {
  const messagesContainer = document.getElementById("messages-container");
  const welcomeMessage = document.querySelector(".welcome-message");
  const messageInput = document.getElementById("prompt-input");
  const sendBtn = document.getElementById("send-button");
  const stopBtn = document.getElementById("stop-button");
  const statusIndicator = document.getElementById("status-indicator");
  const statusText = document.getElementById("status-text");
  const newTaskButton = document.getElementById("new-task-button");
  const taskList = document.getElementById("task-list");
  const noTasks = document.getElementById("no-tasks");
  const contextBadge = document.getElementById("context-badge");

  const ASSISTANT_AVATAR = "assistant.png";
  const USER_AVATAR = "user.png";

  let currentChatId = generateId();
  let chats = {};
  chats[currentChatId] = { messages: [] };

  const socket = new WebSocket("ws://localhost:8081");

  socket.onopen = () => {
    statusIndicator.classList.add("active");
    statusText.textContent = "Connected";
    addSystemMessage("Connected to Argon AI assistant server", "success");
  };

  socket.onclose = () => {
    statusIndicator.classList.remove("active");
    statusText.textContent = "Disconnected";
    addSystemMessage("Disconnected from Argon AI assistant server", "error");
  };

  socket.onerror = (error) => {
    statusIndicator.classList.remove("active");
    statusText.textContent = "Connection Error";
    addSystemMessage(
      "Connection error. Please check if the server is running.",
      "error"
    );
    console.error("WebSocket error:", error);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "response") {
        removeTypingIndicator();
        processAssistantResponse(data.content);
      } else if (data.type === "status") {
        showTypingIndicator(data.content);
      } else if (data.type === "error") {
        removeTypingIndicator();
        addSystemMessage(`Error: ${data.content}`, "error");
      }
    } catch (e) {
      console.error("Error parsing message:", e);
      addSystemMessage("Error processing server response", "error");
    }
  };

  function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    if (welcomeMessage) {
      welcomeMessage.style.display = "none";
    }

    addMessage("user", message);
    showTypingIndicator("Thinking");

    socket.send(JSON.stringify({ type: "message", content: message }));
    messageInput.value = "";
    adjustTextareaHeight();
  }

  function processAssistantResponse(content) {
    if (isNoActionSequence(content)) {
      const formattedMessage = formatContent(
        "**Operation Completed Successfully**\n\n" +
          "No actions were required for this operation."
      );
      addSystemMessage(formattedMessage, "info");
      return;
    }

    const steps = extractMeaningfulSteps(content);

    if (steps.length > 0) {
      steps.forEach((step) => {
        const cleanedStep = cleanStepPresentation(step);
        if (cleanedStep) {
          addMessage("assistant", formatContent(cleanedStep));
        }
      });
    } else {
      addMessage("assistant", formatContent(content));
    }
  }

  function isNoActionSequence(content) {
    const noActionPattern =
      /(Step \d+: Thinking complete - no action needed[\s\S]*?){2,}/i;
    return noActionPattern.test(content);
  }

  function extractMeaningfulSteps(content) {
    return content
      .split(/(Step \d+:)/i)
      .filter((s) => s.trim())
      .reduce((acc, curr, i, arr) => {
        if (/^Step \d+:$/i.test(curr)) {
          const next = arr[i + 1] || "";
          if (!/Thinking complete - no action needed/i.test(next)) {
            acc.push(curr + next);
          }
        }
        return acc;
      }, []);
  }

  function cleanStepPresentation(step) {
    return step
      .replace(/^Step \d+:\s*/i, "")
      .replace(/Thinking complete\s*-?\s*no action needed[.!]?\s*/gi, "")
      .trim();
  }

  function addMessage(role, content) {
    const messageType = determineMessageType(content);
    const messageElement = document.createElement("div");
    messageElement.className = `message ${role} ${messageType}`;

    const processedContent = processContent(content);
    const formattedContent = formatContent(processedContent);

    messageElement.innerHTML = `
      <div class="message-inner-container">
        <div class="message-avatar">
          <img src="${
            role === "user" ? USER_AVATAR : ASSISTANT_AVATAR
          }" alt="${role}">
        </div>
        <div class="message-content">${formattedContent}</div>
      </div>
    `;

    messageElement.querySelectorAll("pre code").forEach((block) => {
      const copyButton = document.createElement("button");
      copyButton.className = "copy-button";
      copyButton.innerHTML = '<i class="fa fa-copy"></i>';
      copyButton.onclick = () => {
        navigator.clipboard.writeText(block.textContent);
        showNotification("Code copied to clipboard!");
      };
      block.parentNode.insertBefore(copyButton, block);
    });

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function determineMessageType(content) {
    if (content.includes("Observed output")) return "observation";
    if (content.includes("Error:")) return "error";
    if (content.includes("Thinking complete")) return "thinking";
    if (content.includes("based on the web search")) return "summary";
    if (content.includes("Okay, based on")) return "summary";
    return "info";
  }

  function processContent(content) {
    content = content.replace(
      /([A-Z]:\\[^\s]+|\\\\.+?)(?=\s|$)/gi,
      (match) =>
        `<a href="file:///${match}" class="file-link" title="Open in file explorer">${match}</a>`
    );
    content = content.replace(/(\d+\s+)(<.*)/g, (_, num, code) => code);
    return content
      .split("\n")
      .filter(
        (line) =>
          !/^(Observed output|Tool|Metadata|Clicked|Navigated|Scrolled)/i.test(
            line
          )
      )
      .join("\n");
  }

  function formatContent(content) {
    if (typeof marked !== "undefined") {
      marked.setOptions({
        highlight: function (code) {
          return hljs.highlightAuto(code).value;
        },
        langPrefix: "hljs language-",
        sanitize: true,
      });
      return marked.parse(content);
    }
    return content
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n\n/g, "<br><br>")
      .replace(/\n/g, "<br>");
  }

  function showTypingIndicator(text) {
    removeTypingIndicator();
    const typingIndicator = document.createElement("div");
    typingIndicator.className = "message assistant typing-indicator";
    typingIndicator.innerHTML = `
      <div class="message-inner-container">
        <div class="message-avatar">
          <img src="${ASSISTANT_AVATAR}" alt="Assistant">
        </div>
        <div class="message-content">${text}</div>
      </div>
    `;
    messagesContainer.appendChild(typingIndicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function addSystemMessage(content, type = "info") {
    const messageElement = document.createElement("div");
    messageElement.className = `log-entry ${type}`;
    messageElement.innerHTML = `
      <div class="message-inner-container">
        <div class="message-avatar">
          <img src="${ASSISTANT_AVATAR}" alt="System">
        </div>
        <div class="message-content">${content}</div>
      </div>
    `;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeTypingIndicator() {
    const indicator = document.querySelector(".typing-indicator");
    if (indicator) indicator.remove();
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  function adjustTextareaHeight() {
    messageInput.style.height = "auto";
    messageInput.style.height = messageInput.scrollHeight + "px";
  }

  function createNewChat() {
    currentChatId = generateId();
    chats[currentChatId] = { messages: [] };
    messagesContainer.innerHTML = "";
    if (welcomeMessage) welcomeMessage.style.display = "flex";
    contextBadge.textContent = `Current Discussion: New Chat`;
    contextBadge.style.opacity = 1;
    setTimeout(() => {
      contextBadge.style.opacity = 0;
    }, 3000);
  }

  function showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    document.getElementById("notifications").appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("file-link")) {
      e.preventDefault();
      const path = e.target.getAttribute("href").replace("file:///", "");
      showNotification(
        `Cannot open paths directly in browser - security restriction`
      );
    }
  });

  sendBtn.addEventListener("click", sendMessage);
  newTaskButton.addEventListener("click", createNewChat);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  messageInput.addEventListener("input", adjustTextareaHeight);
  stopBtn.addEventListener("click", () => {
    socket.send(JSON.stringify({ type: "stop" }));
    removeTypingIndicator();
    stopBtn.disabled = true;
    addSystemMessage("Generation stopped", "info");
  });
});
