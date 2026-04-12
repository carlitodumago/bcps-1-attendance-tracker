/**
 * BCPS-1 Scheduler Service Worker
 *
 * This service worker handles background execution of scheduled tasks,
 * ensuring that officer status changes occur even when:
 * - The application is closed
 * - The device enters sleep mode
 * - The browser tab is inactive
 *
 * @version 1.0.0
 */

// ============================================================================
// Constants
// ============================================================================

const CACHE_NAME = "bcsp1-scheduler-v1";
const SCHEDULER_STORAGE_KEY = "bcsp-1-scheduled-tasks";
const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

// ============================================================================
// Service Worker Events
// ============================================================================

/**
 * Install event - Set up the service worker
 */
self.addEventListener("install", (event) => {
  console.log("[Scheduler SW] Installing...");

  // Skip waiting to activate immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Scheduler SW] Cache opened");
      return cache;
    }),
  );
});

/**
 * Activate event - Start background processing
 */
self.addEventListener("activate", (event) => {
  console.log("[Scheduler SW] Activated");

  // Claim all clients
  event.waitUntil(self.clients.claim());

  // Start the background check interval
  startBackgroundChecks();
});

/**
 * Message event - Handle messages from the main app
 */
self.addEventListener("message", (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "SCHEDULE_TASK":
      handleScheduleTask(payload);
      break;
    case "CANCEL_TASK":
      handleCancelTask(payload);
      break;
    case "GET_TASKS":
      sendTasksToClient(event.source);
      break;
    case "EXECUTE_TASK_NOW":
      executeTask(payload.taskId);
      break;
    default:
      console.log("[Scheduler SW] Unknown message type:", type);
  }
});

/**
 * Sync event - Handle background sync (for offline support)
 */
self.addEventListener("sync", (event) => {
  if (event.tag === "check-scheduled-tasks") {
    event.waitUntil(checkAndExecuteTasks());
  }
});

/**
 * Push event - Handle push notifications (optional, for reminders)
 */
self.addEventListener("push", (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-192x192.png",
        badge: "/badge-72x72.png",
        tag: data.tag,
        requireInteraction: true,
      }),
    );
  }
});

/**
 * Notification click event
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      if (clientList.length > 0) {
        // Focus existing client
        clientList[0].focus();
      } else {
        // Open new window
        self.clients.openWindow("/");
      }
    }),
  );
});

// ============================================================================
// Task Management Functions
// ============================================================================

/**
 * Start background interval checks
 */
function startBackgroundChecks() {
  console.log("[Scheduler SW] Starting background checks");

  // Initial check
  checkAndExecuteTasks();

  // Set up interval
  setInterval(() => {
    checkAndExecuteTasks();
  }, CHECK_INTERVAL_MS);
}

/**
 * Check all scheduled tasks and execute any that are due
 */
async function checkAndExecuteTasks() {
  try {
    const tasks = await getTasksFromStorage();
    // Compare using local timezone to match scheduling logic
    const nowStr = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Manila",
    });
    const nowInPh = new Date(nowStr);

    for (const task of tasks) {
      if (task.status === "pending") {
        const scheduledTime = new Date(task.scheduledTime);
        if (scheduledTime <= nowInPh) {
          console.log("[Scheduler SW] Task due for execution:", task.id);
          await executeTask(task.id);
        }
      }
    }
  } catch (error) {
    console.error("[Scheduler SW] Error checking tasks:", error);
  }
}

/**
 * Execute a scheduled task
 */
async function executeTask(taskId) {
  try {
    const tasks = await getTasksFromStorage();
    const taskIndex = tasks.findIndex((t) => t.id === taskId);

    if (taskIndex === -1) {
      console.error("[Scheduler SW] Task not found:", taskId);
      return;
    }

    const task = tasks[taskIndex];

    if (task.status !== "pending") {
      console.log("[Scheduler SW] Task already processed:", taskId);
      return;
    }

    // Mark task as executed
    task.status = "executed";
    task.executedAt = new Date().toISOString();

    // Save updated tasks
    await saveTasksToStorage(tasks);

    // Notify all clients about the execution
    await notifyClients("TASK_EXECUTED", {
      taskId: task.id,
      officerId: task.officerId,
      officerName: task.officerName,
      scheduledStatus: task.scheduledStatus,
      executedAt: task.executedAt,
    });

    // Show notification
    await showExecutionNotification(task);

    console.log("[Scheduler SW] Task executed successfully:", taskId);
  } catch (error) {
    console.error("[Scheduler SW] Error executing task:", error);

    // Mark task as failed
    const tasks = await getTasksFromStorage();
    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex !== -1) {
      tasks[taskIndex].status = "failed";
      tasks[taskIndex].executedAt = new Date().toISOString();
      await saveTasksToStorage(tasks);
    }
  }
}

/**
 * Handle a new scheduled task
 */
async function handleScheduleTask(task) {
  try {
    const tasks = await getTasksFromStorage();

    // Remove any existing pending tasks for this officer
    const filteredTasks = tasks.filter(
      (t) => !(t.officerId === task.officerId && t.status === "pending"),
    );

    // Add the new task
    filteredTasks.push(task);

    await saveTasksToStorage(filteredTasks);

    console.log("[Scheduler SW] Task scheduled:", task.id);

    // Notify clients
    await notifyClients("TASK_SCHEDULED", task);
  } catch (error) {
    console.error("[Scheduler SW] Error scheduling task:", error);
  }
}

/**
 * Handle task cancellation
 */
async function handleCancelTask(taskId) {
  try {
    const tasks = await getTasksFromStorage();
    const taskIndex = tasks.findIndex((t) => t.id === taskId);

    if (taskIndex === -1) {
      console.error("[Scheduler SW] Task not found for cancellation:", taskId);
      return;
    }

    tasks[taskIndex].status = "cancelled";
    tasks[taskIndex].cancelledAt = new Date().toISOString();

    await saveTasksToStorage(tasks);

    console.log("[Scheduler SW] Task cancelled:", taskId);

    // Notify clients
    await notifyClients("TASK_CANCELLED", { taskId });
  } catch (error) {
    console.error("[Scheduler SW] Error cancelling task:", error);
  }
}

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Get tasks from IndexedDB or localStorage fallback
 */
async function getTasksFromStorage() {
  try {
    // Try IndexedDB first (more reliable in service worker)
    const db = await openDatabase();
    const tasks = await getTasksFromDB(db);
    return tasks;
  } catch (error) {
    // Fallback: return empty array
    console.warn("[Scheduler SW] Using empty task list as fallback");
    return [];
  }
}

/**
 * Save tasks to IndexedDB
 */
async function saveTasksToStorage(tasks) {
  try {
    const db = await openDatabase();
    await saveTasksToDB(db, tasks);
  } catch (error) {
    console.error("[Scheduler SW] Failed to save tasks:", error);
    throw error;
  }
}

/**
 * Open IndexedDB database
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("BCSP1Scheduler", 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("tasks")) {
        db.createObjectStore("tasks", { keyPath: "id" });
      }
    };
  });
}

/**
 * Get tasks from IndexedDB
 */
function getTasksFromDB(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["tasks"], "readonly");
    const store = transaction.objectStore("tasks");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save tasks to IndexedDB
 */
function saveTasksToDB(db, tasks) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["tasks"], "readwrite");
    const store = transaction.objectStore("tasks");

    // Clear existing tasks
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      // Add all tasks
      tasks.forEach((task) => {
        store.put(task);
      });
      resolve();
    };

    clearRequest.onerror = () => reject(clearRequest.error);
  });
}

// ============================================================================
// Client Communication
// ============================================================================

/**
 * Send tasks to a specific client
 */
async function sendTasksToClient(client) {
  try {
    const tasks = await getTasksFromStorage();
    client.postMessage({
      type: "TASKS_LIST",
      payload: tasks,
    });
  } catch (error) {
    console.error("[Scheduler SW] Error sending tasks to client:", error);
  }
}

/**
 * Notify all clients about an event
 */
async function notifyClients(type, payload) {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => {
    client.postMessage({ type, payload });
  });
}

/**
 * Show notification for task execution
 */
async function showExecutionNotification(task) {
  try {
    const statusText =
      task.scheduledStatus === "off-duty" ? "Off Duty" : "On Duty";
    await self.registration.showNotification("BCPS-1 Status Update", {
      body: `${task.officerName} is now ${statusText}`,
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      tag: `task-${task.id}`,
      requireInteraction: false,
      actions: [
        {
          action: "view",
          title: "View Log",
        },
      ],
    });
  } catch (error) {
    console.error("[Scheduler SW] Failed to show notification:", error);
  }
}

// ============================================================================
// Periodic Background Sync (if supported)
// ============================================================================

/**
 * Register periodic background sync
 */
async function registerPeriodicSync() {
  if ("periodicSync" in self.registration) {
    try {
      await self.registration.periodicSync.register("check-scheduled-tasks", {
        minInterval: 15 * 60 * 1000, // 15 minutes
      });
      console.log("[Scheduler SW] Periodic sync registered");
    } catch (error) {
      console.error("[Scheduler SW] Failed to register periodic sync:", error);
    }
  }
}

// Register periodic sync when activated
self.addEventListener("activate", () => {
  registerPeriodicSync();
});

console.log("[Scheduler SW] Service worker loaded");
