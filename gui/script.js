document.addEventListener("DOMContentLoaded", () => {
  const promptInput = document.getElementById("prompt-input");
  const sendButton = document.getElementById("send-button");
  const stopButton = document.getElementById("stop-button");
  const messagesContainer = document.getElementById("messages-container");
  const taskList = document.getElementById("task-list");
  const noTasksElement = document.getElementById("no-tasks");
  const newTaskButton = document.getElementById("new-task-button");
  const statusDot = document.getElementById("status-indicator");
  const statusText = document.getElementById("status-text");
  const contextBadge = document.getElementById("context-badge");
  const notificationsContainer = document.getElementById("notifications");
  const toggleSidebarButton = document.getElementById("toggle-sidebar");
  const sidebar = document.getElementById("sidebar");

  let tasks = [];
  let currentTaskId = null;
  let isProcessing = false;
  let abortController = null;

  promptInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
    if (this.scrollHeight > 200) {
      this.style.height = "200px";
    }
  });

  toggleSidebarButton.addEventListener("click", () => {
    sidebar.classList.toggle("show");
  });

  newTaskButton.addEventListener("click", createNewTask);

  sendButton.addEventListener("click", () => sendPrompt());
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  stopButton.addEventListener("click", () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
      setProcessingState(false);
      showNotification("Agent stopped", "warning");
    }
  });

  const socket = new WebSocket(`ws://${window.location.host}/ws`);

  socket.onopen = () => {
    setConnectionStatus(true);
    showNotification("Connected to server", "success");
    addSystemMessage("Connected to OpenManus. Ready to assist you.");
  };

  socket.onclose = () => {
    setConnectionStatus(false);
    showNotification("Disconnected from server", "error");
    addSystemMessage("Connection lost. Please refresh the page to reconnect.");
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    showNotification("Connection error", "error");
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "log") {
      addLogEntry(data.message, data.level || "info");

      if (data.level === "success" || data.message.includes("completed")) {
        setProcessingState(false);
      }
    } else if (data.type === "response") {
      parseAndDisplaySteps(data.message);
      setProcessingState(false);
    } else if (data.type === "error") {
      addLogEntry(data.message, "error");
      showNotification(data.message, "error");
      setProcessingState(false);
    } else if (data.type === "processing") {
      setProcessingState(true);
    }
  };

  function sendPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt || isProcessing) return;

    if (!currentTaskId) {
      createNewTask().then(() => {
        executePrompt(prompt);
      });
    } else {
      executePrompt(prompt);
    }
  }

  function executePrompt(prompt) {
    addUserMessage(prompt);

    promptInput.value = "";
    promptInput.style.height = "auto";

    setProcessingState(true);

    abortController = new AbortController();

    sendToServer({
      type: "prompt",
      prompt: prompt,
      taskId: currentTaskId,
      signal: abortController.signal,
    });
  }

  function sendToServer(data) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    } else {
      showNotification("Connection not available", "error");
      setProcessingState(false);
    }
  }

  function setConnectionStatus(isConnected) {
    if (isConnected) {
      statusDot.classList.remove("inactive");
      statusDot.classList.add("active");
      statusText.textContent = "Connected";
    } else {
      statusDot.classList.remove("active");
      statusDot.classList.add("inactive");
      statusText.textContent = "Disconnected";
    }
  }

  function setProcessingState(processing) {
    isProcessing = processing;

    if (processing) {
      sendButton.disabled = true;
      sendButton.style.display = "none";
      stopButton.disabled = false;
      stopButton.style.display = "flex";
    } else {
      sendButton.disabled = false;
      sendButton.style.display = "flex";
      stopButton.disabled = true;
      stopButton.style.display = "none";
    }
  }

  function addUserMessage(content) {
    const messageElement = document.createElement("div");
    messageElement.className = "message user";

    const contentElement = document.createElement("div");
    contentElement.className = "message-content";
    contentElement.textContent = content;

    const timestampElement = document.createElement("div");
    timestampElement.className = "timestamp";
    timestampElement.textContent = getCurrentTime();

    messageElement.appendChild(contentElement);
    messageElement.appendChild(timestampElement);

    messagesContainer.appendChild(messageElement);
    scrollToBottom();

    if (currentTaskId) {
      updateTaskPreview(currentTaskId, content);
    }
  }

  function parseAndDisplaySteps(content) {
    const stepRegex = /Step \d+:.*?(?=\nStep \d+|$)/gs;
    const steps = content.match(stepRegex);

    if (steps) {
      steps.forEach((step) => {
        addSystemMessage(step);
      });
    } else {
      addSystemMessage(content);
    }
  }

  function addSystemMessage(content) {
    const messageElement = document.createElement("div");
    messageElement.className = "message system";

    // Create content container
    const contentContainer = document.createElement("div");
    contentContainer.className = "message-inner-container";

    // Create avatar element
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.innerHTML =
      '<img src="https://www.3win.ai/wp-content/uploads/2025/03/image-110.png" alt="User Avatar">';

    // Create content element
    const contentElement = document.createElement("div");
    contentElement.className = "message-content";

    // Format the content with proper line breaks and list items
    const formattedContent = content
      .split("\n")
      .map((line) => {
        if (line.startsWith("* ")) {
          return `<div class="list-item">${line.substring(2)}</div>`;
        }
        return line;
      })
      .join("<br>");

    contentElement.innerHTML = formattedContent;

    // Create timestamp
    const timestamp = document.createElement("div");
    timestamp.className = "timestamp";
    timestamp.textContent = getCurrentTime();

    // Assemble elements
    contentContainer.appendChild(avatar);
    contentContainer.appendChild(contentElement);
    messageElement.appendChild(contentContainer);
    messageElement.appendChild(timestamp);

    messagesContainer.appendChild(messageElement);
    scrollToBottom();
  }

  function addLogEntry(content, level = "info") {
    const logElement = document.createElement("div");
    logElement.className = `log-entry ${level}`;

    const pathRegex = /[A-Za-z]:\\[^\s]+/g;
    const parts = content.split(pathRegex);
    const matches = content.match(pathRegex);

    if (matches) {
      parts.forEach((part, index) => {
        const span = document.createElement("span");
        span.textContent = part;

        logElement.appendChild(span);

        if (index < matches.length) {
          const path = matches[index];
          const link = document.createElement("a");
          link.className = "path-link";
          link.textContent = path;
          link.href = `file://${path}`;
          link.target = "_blank";

          logElement.appendChild(link);
        }
      });
    } else {
      logElement.textContent = content;
    }

    messagesContainer.appendChild(logElement);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getFormattedDate() {
    const now = new Date();
    return (
      now.toLocaleDateString() +
      " " +
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  function showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.textContent = message;

    notificationsContainer.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  async function createNewTask() {
    const taskId = "task_" + Date.now();
    const timestamp = getFormattedDate();
    const newTask = {
      id: taskId,
      title: "New Task",
      preview: "No content yet",
      timestamp: timestamp,
      messages: [],
    };

    tasks.push(newTask);
    createTaskElement(newTask);
    selectTask(taskId);
    updateLocalStorage();

    return taskId;
  }

  function createTaskElement(task) {
    noTasksElement.style.display = "none";
    const taskElement = document.createElement("div");
    taskElement.className = "task-item";
    taskElement.id = `task-${task.id}`;
    taskElement.dataset.taskId = task.id;

    const titleElement = document.createElement("div");
    titleElement.className = "task-title";
    titleElement.textContent = task.title;

    const previewElement = document.createElement("div");
    previewElement.className = "task-preview";
    previewElement.textContent = task.preview;

    const timestampElement = document.createElement("div");
    timestampElement.className = "timestamp";
    timestampElement.textContent = task.timestamp;

    taskElement.appendChild(titleElement);
    taskElement.appendChild(previewElement);
    taskElement.appendChild(timestampElement);

    taskElement.addEventListener("click", () => {
      selectTask(task.id);
    });

    taskList.insertBefore(taskElement, taskList.firstChild);
  }

  function selectTask(taskId) {
    document.querySelectorAll(".task-item").forEach((item) => {
      item.classList.remove("selected");
    });

    const taskElement = document.getElementById(`task-${taskId}`);
    if (taskElement) {
      taskElement.classList.add("selected");
    }

    currentTaskId = taskId;
    messagesContainer.innerHTML = "";

    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      if (task.messages && task.messages.length > 0) {
        task.messages.forEach((msg) => {
          if (msg.sender === "user") {
            addUserMessage(msg.content);
          } else {
            addSystemMessage(msg.content);
          }
        });
      } else {
        addSystemMessage("New task started. Enter your prompt to begin.");
      }

      contextBadge.textContent = `Current task: ${task.title}`;
      contextBadge.style.opacity = "1";
      setTimeout(() => {
        contextBadge.style.opacity = "0";
      }, 3000);
    }

    if (window.innerWidth <= 768) {
      sidebar.classList.remove("show");
    }
  }

  function updateTaskPreview(taskId, content) {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      task.preview =
        content.length > 40 ? content.substring(0, 40) + "..." : content;
      task.title = `Task ${tasks.indexOf(task) + 1}`;
      task.messages.push({
        sender: "user",
        content: content,
        timestamp: new Date().toISOString(),
      });

      const taskElement = document.getElementById(`task-${taskId}`);
      if (taskElement) {
        const titleElement = taskElement.querySelector(".task-title");
        const previewElement = taskElement.querySelector(".task-preview");

        if (titleElement) titleElement.textContent = task.title;
        if (previewElement) previewElement.textContent = task.preview;
      }

      updateLocalStorage();
    }
  }

  function updateLocalStorage() {
    localStorage.setItem("openmanus_tasks", JSON.stringify(tasks));
  }

  function loadTasksFromStorage() {
    const storedTasks = localStorage.getItem("openmanus_tasks");
    if (storedTasks) {
      tasks = JSON.parse(storedTasks);
      if (tasks.length > 0) {
        noTasksElement.style.display = "none";
        tasks.forEach((task) => createTaskElement(task));
      }
    }
  }

  loadTasksFromStorage();
});
