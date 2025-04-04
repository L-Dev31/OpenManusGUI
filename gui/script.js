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
    addSystemMessage("Connected to Argon AI server", "success");
  };

  socket.onclose = () => {
    statusIndicator.classList.remove("active");
    statusText.textContent = "Disconnected";
    addSystemMessage("Disconnected from server", "error");
  };

  socket.onerror = (error) => {
    statusIndicator.classList.remove("active");
    statusText.textContent = "Error";
    addSystemMessage("Connection error", "error");
    console.error("WebSocket error:", error);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (e) {
      console.error("Error parsing message:", e);
      addSystemMessage("Error processing response", "error");
    }
  };

  function handleSocketMessage(data) {
    switch (data.type) {
      case "response":
        removeTypingIndicator();
        processAssistantResponse(data.content);
        break;
      case "status":
        showTypingIndicator(data.content);
        break;
      case "error":
        removeTypingIndicator();
        addSystemMessage(`Error: ${data.content}`, "error");
        break;
      case "config":
        populateConfigForm(data.content);
        break;
      case "notification":
        showNotification(data.content);
        break;
    }
  }

  function setupModals() {
    const modals = document.querySelectorAll(".modal");
    const overlay = document.getElementById("modal-overlay");

    document.querySelectorAll("[data-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.dataset.modal;
        const modal = document.getElementById(modalId);
        modal.style.display = "flex";
        overlay.style.display = "block";

        if (modalId === "settings-modal") {
          loadConfig();
        }
      });
    });

    document.querySelectorAll(".modal-close, #modal-overlay").forEach((el) => {
      el.addEventListener("click", closeAllModals);
    });

    document.querySelectorAll("[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabId = tab.dataset.tab;
        document.querySelectorAll(".tab-btn, .tab-content").forEach((el) => {
          el.classList.remove("active");
        });
        tab.classList.add("active");
        document.getElementById(tabId).classList.add("active");
      });
    });

    document.querySelectorAll('input[type="range"]').forEach((range) => {
      const display = range.parentElement.querySelector(".value-display");
      display.textContent = range.value;
      range.addEventListener("input", () => {
        display.textContent = range.value;
      });
    });

    document.getElementById("config-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveConfig();
    });

    document.querySelectorAll(".use-template").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const templateText = e.target
          .closest(".template-item")
          .querySelector("p").textContent;
        messageInput.value = templateText;
        closeAllModals();
        messageInput.focus();
      });
    });
  }

  function closeAllModals() {
    document
      .querySelectorAll(".modal")
      .forEach((m) => (m.style.display = "none"));
    document.getElementById("modal-overlay").style.display = "none";
  }

  function loadConfig() {
    socket.send(JSON.stringify({ type: "config", action: "get" }));
  }

  function saveConfig() {
    const formData = new FormData(document.getElementById("config-form"));
    const configData = {
      llm: {
        model: formData.get("llm.model"),
        base_url: formData.get("llm.base_url"),
        api_key: formData.get("llm.api_key"),
        max_tokens: parseInt(formData.get("llm.max_tokens")),
        temperature: parseFloat(formData.get("llm.temperature")),
      },
      mcp: {
        server_reference: formData.get("mcp.server_reference"),
      },
    };

    socket.send(
      JSON.stringify({
        type: "config",
        action: "save",
        content: configData,
      })
    );
  }

  function populateConfigForm(config) {
    if (!config) return;

    const form = document.getElementById("config-form");
    if (config.llm) {
      form.elements["llm.model"].value = config.llm.model || "";
      form.elements["llm.base_url"].value = config.llm.base_url || "";
      form.elements["llm.api_key"].value = config.llm.api_key || "";
      form.elements["llm.max_tokens"].value = config.llm.max_tokens || 4096;
      form.elements["llm.temperature"].value = config.llm.temperature || 0.0;
    }
    if (config.mcp) {
      form.elements["mcp.server_reference"].value =
        config.mcp.server_reference || "";
    }
  }

  function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    if (welcomeMessage) welcomeMessage.style.display = "none";

    addMessage("user", message);
    showTypingIndicator("Thinking...");

    socket.send(
      JSON.stringify({
        type: "message",
        content: message,
        chatId: currentChatId,
      })
    );

    messageInput.value = "";
  }

  function processAssistantResponse(content) {
    if (!content) return;

    try {
      const parsed = tryParseJSON(content);
      if (parsed && parsed.type === "special") {
        handleSpecialResponse(parsed);
        return;
      }

      if (isNoActionSequence(content)) {
        addSystemMessage("Operation completed successfully", "success");
        return;
      }

      const steps = extractMeaningfulSteps(content);
      if (steps.length > 0) {
        steps.forEach((step) => {
          const cleaned = cleanStepPresentation(step);
          if (cleaned) addMessage("assistant", formatContent(cleaned));
        });
      } else {
        addMessage("assistant", formatContent(content));
      }
    } catch (e) {
      console.error("Error processing response:", e);
      addMessage("assistant", formatContent(content));
    }
  }

  function tryParseJSON(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  function handleSpecialResponse(data) {
    switch (data.action) {
      case "notification":
        showNotification(data.message);
        break;
      case "file":
        showNotification(`File operation: ${data.path}`);
        break;
      default:
        addSystemMessage(data.message || "Special action received", "info");
    }
  }

  function isNoActionSequence(content) {
    return /(Step \d+: Thinking complete - no action needed[\s\S]*?){2,}/i.test(
      content
    );
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
    if (!content) return;

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

    addCopyButtons(messageElement);
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (role === "assistant") {
      saveToChatHistory(role, content);
    }
  }

  function addCopyButtons(element) {
    element.querySelectorAll("pre code").forEach((block) => {
      const copyButton = document.createElement("button");
      copyButton.className = "copy-button";
      copyButton.innerHTML = '<i class="fas fa-copy"></i>';
      copyButton.onclick = () => copyToClipboard(block.textContent);
      block.parentNode.insertBefore(copyButton, block);
    });
  }

  function copyToClipboard(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => showNotification("Copied to clipboard!"))
      .catch((err) => console.error("Copy failed:", err));
  }

  function determineMessageType(content) {
    if (content.includes("Observed output")) return "observation";
    if (content.includes("Error:")) return "error";
    if (content.includes("Thinking complete")) return "thinking";
    if (content.includes("based on the web search")) return "summary";
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
        highlight: (code) => hljs.highlightAuto(code).value,
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

  function removeTypingIndicator() {
    const indicator = document.querySelector(".typing-indicator");
    if (indicator) indicator.remove();
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

  function showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    document.getElementById("notifications").appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  function createNewChat() {
    currentChatId = generateId();
    chats[currentChatId] = { messages: [] };
    messagesContainer.innerHTML = "";
    if (welcomeMessage) welcomeMessage.style.display = "flex";
    updateContextBadge("New Chat");
  }

  function saveToChatHistory(role, content) {
    if (!chats[currentChatId]) chats[currentChatId] = { messages: [] };
    chats[currentChatId].messages.push({ role, content });
  }

  function updateContextBadge(text) {
    contextBadge.textContent = `Current Discussion: ${text}`;
    contextBadge.style.opacity = 1;
    setTimeout(() => (contextBadge.style.opacity = 0), 3000);
  }

  messageInput.addEventListener("focus", () => {
    messageInput.classList.add("expanded");
  });

  messageInput.addEventListener("blur", () => {
    if (!messageInput.value.trim()) {
      messageInput.classList.remove("expanded");
    }
  });

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  function initEventListeners() {
    sendBtn.addEventListener("click", sendMessage);
    newTaskButton.addEventListener("click", createNewChat);
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    messageInput.addEventListener("input");
    stopBtn.addEventListener("click", () => {
      socket.send(JSON.stringify({ type: "stop" }));
      removeTypingIndicator();
      stopBtn.disabled = true;
      addSystemMessage("Generation stopped", "info");
    });
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("file-link")) {
        e.preventDefault();
        showNotification("File links are not clickable in browser");
      }
    });
  }

  setupModals();
  initEventListeners();
});
