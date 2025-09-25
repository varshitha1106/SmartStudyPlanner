(function() {
	"use strict";

	// Storage keys
	const STORAGE_KEYS = {
		tasks: "ssp.tasks.v1",
		goals: "ssp.goals.v1",
		settings: "ssp.settings.v1",
		stats: "ssp.stats.v1"
	};

	// App state
	let tasks = [];
	let goals = [];
	let settings = { notificationsEnabled: false, theme: 'dark' };
	let stats = { // focus stats
		streakDays: 0,
		lastFocusDate: "",
		todaySessions: 0,
		todayMinutes: 0
	};
	let reminderTimers = new Map(); // taskId -> timeoutId

	// Focus timer state
	let focus = {
		phase: 'idle', // 'work' | 'break' | 'idle'
		remainingSec: 25 * 60,
		workMin: 25,
		breakMin: 5,
		taskId: "",
		intervalId: null
	};

	// Helpers
	const qs = (sel, root = document) => root.querySelector(sel);
	const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
	const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
	const todayISO = () => new Date().toISOString().slice(0, 10);
	const parseDateTime = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr || "00:00"}`);
	const formatTime = d => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	const formatDate = d => d.toLocaleDateString();
	const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

	function saveAll() {
		localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
		localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(goals));
		localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
		localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
	}

	function loadAll() {
		try {
			tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.tasks) || "[]");
			goals = JSON.parse(localStorage.getItem(STORAGE_KEYS.goals) || "[]");
			settings = Object.assign({ notificationsEnabled: false, theme: preferredTheme() }, JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}"));
			stats = Object.assign({}, stats, JSON.parse(localStorage.getItem(STORAGE_KEYS.stats) || "{}"));
		} catch (e) {
			console.error("Failed to load storage", e);
			tasks = [];
			goals = [];
			settings = { notificationsEnabled: false, theme: preferredTheme() };
			stats = { streakDays: 0, lastFocusDate: "", todaySessions: 0, todayMinutes: 0 };
		}
	}

	function preferredTheme() {
		return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	}

	function applyTheme(theme) {
		document.documentElement.setAttribute('data-theme', theme);
		const btn = document.getElementById('themeToggle');
		if (btn) btn.textContent = theme === 'light' ? '🌞' : '🌙';
	}

	function notify(title, body) {
		if (!settings.notificationsEnabled) return;
		if (Notification.permission === "granted") {
			new Notification(title, { body });
		} else if (Notification.permission !== "denied") {
			Notification.requestPermission().then(p => {
				settings.notificationsEnabled = (p === "granted");
				saveAll();
				if (p === "granted") new Notification(title, { body });
			});
		}
	}

	// DOM elements
	const els = {
		// tabs
		taskTabBtn: qs('#taskTabBtn'),
		goalTabBtn: qs('#goalTabBtn'),
		taskForm: qs('#taskForm'),
		goalForm: qs('#goalForm'),
		// task inputs
		taskTitle: qs('#taskTitle'),
		taskSubject: qs('#taskSubject'),
		taskDueDate: qs('#taskDueDate'),
		taskDueTime: qs('#taskDueTime'),
		taskDuration: qs('#taskDuration'),
		taskPriority: qs('#taskPriority'),
		taskReminderMinutes: qs('#taskReminderMinutes'),
		taskGoalLink: qs('#taskGoalLink'),
		taskNotes: qs('#taskNotes'),
		// lists and filters
		taskList: qs('#taskList'),
		taskSearch: qs('#taskSearch'),
		taskFilter: qs('#taskFilter'),
		goalList: qs('#goalList'),
		timeline: qs('#timeline'),
		// goals form
		goalTitle: qs('#goalTitle'),
		goalTargetDate: qs('#goalTargetDate'),
		goalDescription: qs('#goalDescription'),
		// controls
		todayBtn: qs('#todayBtn'),
		weekBtn: qs('#weekBtn'),
		notificationsToggle: qs('#notificationsToggle'),
		exportDataBtn: qs('#exportDataBtn'),
		importDataBtn: qs('#importDataBtn'),
		importFileInput: qs('#importFileInput'),
		themeToggle: qs('#themeToggle'),
		// focus timer
		focusTaskSelect: qs('#focusTaskSelect'),
		focusWorkMin: qs('#focusWorkMin'),
		focusBreakMin: qs('#focusBreakMin'),
		focusTime: qs('#focusTime'),
		focusStartBtn: qs('#focusStartBtn'),
		focusPauseBtn: qs('#focusPauseBtn'),
		focusResetBtn: qs('#focusResetBtn'),
		focusPhaseLabel: qs('#focusPhaseLabel'),
		focusStats: qs('#focusStats'),
		focusStreakLabel: qs('#focusStreakLabel'),
		// edit dialog
		editDialog: qs('#editTaskDialog'),
		editTaskForm: qs('#editTaskForm'),
		editTaskId: qs('#editTaskId'),
		editTaskTitle: qs('#editTaskTitle'),
		editTaskSubject: qs('#editTaskSubject'),
		editTaskDueDate: qs('#editTaskDueDate'),
		editTaskDueTime: qs('#editTaskDueTime'),
		editTaskDuration: qs('#editTaskDuration'),
		editTaskPriority: qs('#editTaskPriority'),
		editTaskReminderMinutes: qs('#editTaskReminderMinutes'),
		editTaskGoalLink: qs('#editTaskGoalLink'),
		editTaskNotes: qs('#editTaskNotes'),
		saveTaskEditBtn: qs('#saveTaskEditBtn')
	};

	function refreshGoalLinkOptions() {
		const selects = [els.taskGoalLink, els.editTaskGoalLink];
		for (const sel of selects) {
			const current = sel.value;
			sel.innerHTML = '<option value="">— None —</option>' + goals.map(g => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join('');
			sel.value = current;
		}
		// focus select from tasks
		if (els.focusTaskSelect) {
			const current = els.focusTaskSelect.value;
			els.focusTaskSelect.innerHTML = '<option value="">— None —</option>' + tasks.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
			els.focusTaskSelect.value = current;
		}
	}

	function escapeHtml(str) {
		return String(str || "").replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]));
	}

	function computeGoalProgress(goalId) {
		const related = tasks.filter(t => t.goalId === goalId);
		if (related.length === 0) return 0;
		const complete = related.filter(t => t.completed).length;
		return Math.round((complete / related.length) * 100);
	}

	function isOverdue(task) {
		if (task.completed) return false;
		if (!task.dueDate) return false;
		const due = parseDateTime(task.dueDate, task.dueTime || "00:00");
		return Date.now() > due.getTime();
	}

	function scheduleReminder(task) {
		clearReminder(task.id);
		if (!task.dueDate) return;
		const minutes = Number(task.reminderMinutes || 0);
		if (Number.isNaN(minutes) || minutes < 0) return;
		const due = parseDateTime(task.dueDate, task.dueTime || "00:00").getTime();
		const at = due - minutes * 60_000;
		const delay = at - Date.now();
		if (delay <= 0) return; // in the past
		const id = setTimeout(() => {
			notify("Study Reminder", `${task.title} at ${formatTime(new Date(due))}`);
			reminderTimers.delete(task.id);
		}, delay);
		reminderTimers.set(task.id, id);
	}

	function clearReminder(taskId) {
		const id = reminderTimers.get(taskId);
		if (id) {
			clearTimeout(id);
			reminderTimers.delete(taskId);
		}
	}

	function rescheduleAllReminders() {
		for (const id of reminderTimers.values()) clearTimeout(id);
		reminderTimers.clear();
		for (const t of tasks) scheduleReminder(t);
	}

	// Rendering
	function renderTasks() {
		const term = (els.taskSearch.value || "").toLowerCase();
		const filter = els.taskFilter.value;
		let list = tasks.slice().sort((a, b) => {
			const pa = a.priority === 'high' ? 0 : a.priority === 'medium' ? 1 : 2;
			const pb = b.priority === 'high' ? 0 : b.priority === 'medium' ? 1 : 2;
			const ad = a.dueDate ? parseDateTime(a.dueDate, a.dueTime || "00:00").getTime() : Infinity;
			const bd = b.dueDate ? parseDateTime(b.dueDate, b.dueTime || "00:00").getTime() : Infinity;
			if (pa !== pb) return pa - pb;
			return ad - bd;
		});
		if (term) {
			list = list.filter(t => [t.title, t.subject, t.notes].some(s => (s || '').toLowerCase().includes(term)));
		}
		if (filter === 'pending') list = list.filter(t => !t.completed);
		else if (filter === 'completed') list = list.filter(t => t.completed);
		else if (filter === 'overdue') list = list.filter(t => isOverdue(t));
		else if (filter === 'high') list = list.filter(t => t.priority === 'high');

		els.taskList.innerHTML = list.map(t => renderTaskItem(t)).join('');
	}

	function renderTaskItem(t) {
		const overdue = isOverdue(t);
		const goal = t.goalId ? goals.find(g => g.id === t.goalId) : null;
		return `
			<li class="list-item ${t.completed ? 'completed' : ''} ${overdue ? 'overdue' : ''}">
				<input type="checkbox" class="checkbox-lg" data-action="toggle-complete" data-id="${t.id}" ${t.completed ? 'checked' : ''} aria-label="Mark complete">
				<div>
					<div class="item-title">${escapeHtml(t.title)} ${goal ? `<span class=\"priority\" style=\"margin-left:6px;\">${escapeHtml(goal.title)}</span>` : ''}</div>
					<div class="item-sub">
						${t.subject ? escapeHtml(t.subject) + ' · ' : ''}
						${t.dueDate ? `${formatDate(parseDateTime(t.dueDate, t.dueTime))} ${t.dueTime ? formatTime(parseDateTime(t.dueDate, t.dueTime)) : ''}` : 'No due date'}
						· <span class="priority ${t.priority}">${t.priority}</span>
					</div>
				</div>
				<div class="item-actions">
					<button class="btn btn-ghost" data-action="edit" data-id="${t.id}">Edit</button>
					<button class="btn btn-ghost" data-action="delete" data-id="${t.id}">Delete</button>
				</div>
			</li>
		`;
	}

	function renderGoals() {
		els.goalList.innerHTML = goals.map(g => {
			const pct = computeGoalProgress(g.id);
			return `
				<li class="list-item">
					<div style="grid-column: 1 / -1;" class="goal-header">
						<div>
							<div class="item-title">${escapeHtml(g.title)}</div>
							<div class="item-sub">${g.targetDate ? 'Target ' + formatDate(new Date(g.targetDate)) + ' · ' : ''}${escapeHtml(g.description || '')}</div>
						</div>
						<div class="item-actions">
							<button class="btn btn-ghost" data-action="delete-goal" data-id="${g.id}">Delete</button>
						</div>
					</div>
					<div class="progress"><span style="width:${clamp(pct,0,100)}%"></span></div>
				</li>
			`;
		}).join('');
	}

	function renderTimeline() {
		const start = new Date();
		start.setHours(0,0,0,0);
		const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000));
		const byDay = days.map(d => ({ date: d, tasks: [] }));
		for (const t of tasks) {
			if (!t.dueDate) continue;
			const d = parseDateTime(t.dueDate, t.dueTime || "00:00");
			const idx = Math.floor((d - start) / 86400000);
			if (idx >= 0 && idx < 7) byDay[idx].tasks.push(t);
		}
		for (const day of byDay) day.tasks.sort((a,b) => parseDateTime(a.dueDate, a.dueTime || "00:00") - parseDateTime(b.dueDate, b.dueTime || "00:00"));
		els.timeline.innerHTML = byDay.map(({ date, tasks: dTasks }) => `
			<div class="timeline-day">
				<h4>${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h4>
				${dTasks.length === 0 ? '<div class="item-sub">No tasks</div>' : dTasks.map(t => `
					<div class="timeline-task ${isOverdue(t) ? 'overdue' : ''}">
						<div class="t-title">${escapeHtml(t.title)}</div>
						<div class="t-meta">${t.dueTime ? formatTime(parseDateTime(t.dueDate, t.dueTime)) : 'All day'} · ${escapeHtml(t.subject || '')}</div>
					</div>
				`).join('')}
			</div>
		`).join('');
	}

	function renderFocusUI() {
		if (!els.focusTime) return;
		els.focusWorkMin.value = String(focus.workMin);
		els.focusBreakMin.value = String(focus.breakMin);
		els.focusTaskSelect.value = focus.taskId || "";
		const m = Math.floor(focus.remainingSec / 60).toString().padStart(2,'0');
		const s = Math.floor(focus.remainingSec % 60).toString().padStart(2,'0');
		els.focusTime.textContent = `${m}:${s}`;
		els.focusPhaseLabel.textContent = focus.phase === 'work' ? 'Focusing' : focus.phase === 'break' ? 'On break' : 'Ready to focus';
		els.focusStartBtn.textContent = focus.intervalId ? 'Resume' : 'Start';
		els.focusStats.textContent = `${stats.todaySessions} sessions · ${stats.todayMinutes} min`;
		els.focusStreakLabel.textContent = `Streak: ${stats.streakDays} ${stats.streakDays === 1 ? 'day' : 'days'}`;
	}

	function tickFocus() {
		if (focus.remainingSec <= 0) {
			if (focus.phase === 'work') {
				// completed a work session
				stats.todaySessions += 1;
				stats.todayMinutes += focus.workMin;
				const today = todayISO();
				if (stats.lastFocusDate !== today) {
					const yesterday = new Date();
					yesterday.setDate(yesterday.getDate() - 1);
					const yISO = yesterday.toISOString().slice(0,10);
					stats.streakDays = (stats.lastFocusDate === yISO) ? (stats.streakDays + 1) : 1;
					stats.lastFocusDate = today;
				}
				notify('Focus complete', focus.taskId ? `Completed ${focus.workMin} min on task` : `Completed ${focus.workMin} min session`);
				focus.phase = 'break';
				focus.remainingSec = focus.breakMin * 60;
			} else if (focus.phase === 'break') {
				notify('Break over', 'Time to focus again');
				focus.phase = 'idle';
				focus.intervalId && clearInterval(focus.intervalId);
				focus.intervalId = null;
			}
			saveAll();
			renderFocusUI();
			return;
		}
		focus.remainingSec -= 1;
		renderFocusUI();
	}

	function startFocus() {
		if (focus.phase === 'idle') {
			focus.phase = 'work';
			focus.remainingSec = (Number(els.focusWorkMin.value) || focus.workMin) * 60;
			focus.workMin = Math.max(5, Math.min(120, Number(els.focusWorkMin.value) || 25));
			focus.breakMin = Math.max(1, Math.min(60, Number(els.focusBreakMin.value) || 5));
			focus.taskId = els.focusTaskSelect.value || "";
		}
		if (!focus.intervalId) {
			focus.intervalId = setInterval(tickFocus, 1000);
		}
		saveAll();
		renderFocusUI();
	}

	function pauseFocus() {
		if (focus.intervalId) {
			clearInterval(focus.intervalId);
			focus.intervalId = null;
		}
		renderFocusUI();
	}

	function resetFocus() {
		pauseFocus();
		focus.phase = 'idle';
		focus.remainingSec = (Number(els.focusWorkMin?.value) || focus.workMin) * 60;
		renderFocusUI();
	}

	function ensureTodayStats() {
		const today = todayISO();
		if (stats.lastFocusDate !== today) {
			// reset daily counts keeping streak
			stats.todaySessions = 0;
			stats.todayMinutes = 0;
		}
	}

	function renderAll() {
		refreshGoalLinkOptions();
		renderTasks();
		renderGoals();
		renderTimeline();
		renderFocusUI();
	}

	// Event handlers
	function attachEvents() {
		// Tabs
		els.taskTabBtn.addEventListener('click', () => {
			els.taskTabBtn.classList.add('active');
			els.goalTabBtn.classList.remove('active');
			els.taskForm.classList.remove('hidden');
			els.goalForm.classList.add('hidden');
		});
		els.goalTabBtn.addEventListener('click', () => {
			els.goalTabBtn.classList.add('active');
			els.taskTabBtn.classList.remove('active');
			els.goalForm.classList.remove('hidden');
			els.taskForm.classList.add('hidden');
		});

		// Theme toggle
		if (els.themeToggle) {
			els.themeToggle.addEventListener('click', () => {
				settings.theme = settings.theme === 'light' ? 'dark' : 'light';
				applyTheme(settings.theme);
				saveAll();
			});
		}

		// Import / Export
		els.importDataBtn.addEventListener('click', () => els.importFileInput.click());
		els.importFileInput.addEventListener('change', async () => {
			const file = els.importFileInput.files && els.importFileInput.files[0];
			if (!file) return;
			try {
				const text = await file.text();
				const data = JSON.parse(text);
				if (data.tasks && Array.isArray(data.tasks)) tasks = data.tasks;
				if (data.goals && Array.isArray(data.goals)) goals = data.goals;
				if (data.settings && typeof data.settings === 'object') settings = Object.assign({ notificationsEnabled: false, theme: preferredTheme() }, data.settings);
				if (data.stats && typeof data.stats === 'object') stats = Object.assign(stats, data.stats);
				saveAll();
				rescheduleAllReminders();
				renderAll();
				alert('Import successful.');
			} catch (e) {
				console.error(e);
				alert('Import failed. Please select a valid backup JSON.');
			}
			els.importFileInput.value = "";
		});

		els.exportDataBtn.addEventListener('click', () => {
			const payload = { tasks, goals, settings, stats, exportedAt: new Date().toISOString() };
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `smart-study-planner-backup-${new Date().toISOString().slice(0,10)}.json`;
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				URL.revokeObjectURL(url);
				a.remove();
			}, 0);
		});

		// Task add
		els.taskForm.addEventListener('submit', e => {
			e.preventDefault();
			const data = {
				id: uid(),
				title: els.taskTitle.value.trim(),
				subject: els.taskSubject.value.trim(),
				dueDate: els.taskDueDate.value || null,
				dueTime: els.taskDueTime.value || "",
				durationHours: Number(els.taskDuration.value || 0),
				priority: els.taskPriority.value,
				reminderMinutes: Number(els.taskReminderMinutes.value || 0),
				goalId: els.taskGoalLink.value || "",
				notes: els.taskNotes.value.trim(),
				completed: false,
				createdAt: Date.now()
			};
			if (!data.title) return;
			tasks.push(data);
			saveAll();
			scheduleReminder(data);
			renderAll();
			els.taskForm.reset();
			els.taskDueDate.value = todayISO();
		});

		// Goal add
		els.goalForm.addEventListener('submit', e => {
			e.preventDefault();
			const g = {
				id: uid(),
				title: els.goalTitle.value.trim(),
				description: els.goalDescription.value.trim(),
				targetDate: els.goalTargetDate.value || "",
				createdAt: Date.now()
			};
			if (!g.title) return;
			goals.push(g);
			saveAll();
			renderAll();
			els.goalForm.reset();
		});

		// Task interactions
		els.taskList.addEventListener('click', e => {
			const btn = e.target.closest('button, input[type="checkbox"]');
			if (!btn) return;
			const id = btn.getAttribute('data-id');
			const action = btn.getAttribute('data-action');
			if (action === 'delete') {
				const idx = tasks.findIndex(t => t.id === id);
				if (idx !== -1) {
					clearReminder(tasks[idx].id);
					tasks.splice(idx, 1);
					saveAll();
					renderAll();
				}
			} else if (action === 'edit') {
				openEditDialog(id);
			} else if (action === 'toggle-complete') {
				const t = tasks.find(t => t.id === id);
				if (!t) return;
				t.completed = !t.completed;
				if (t.completed) clearReminder(t.id); else scheduleReminder(t);
				saveAll();
				renderAll();
			}
		});

		// Goal deletion
		els.goalList.addEventListener('click', e => {
			const btn = e.target.closest('button');
			if (!btn) return;
			if (btn.getAttribute('data-action') === 'delete-goal') {
				const id = btn.getAttribute('data-id');
				goals = goals.filter(g => g.id !== id);
				for (const t of tasks) if (t.goalId === id) t.goalId = ""; // unlink
				saveAll();
				renderAll();
			}
		});

		// Filters
		els.taskSearch.addEventListener('input', renderTasks);
		els.taskFilter.addEventListener('change', renderTasks);
		els.todayBtn.addEventListener('click', renderTimeline);
		els.weekBtn.addEventListener('click', renderTimeline);

		// Notifications toggle
		els.notificationsToggle.addEventListener('change', async () => {
			if (els.notificationsToggle.checked) {
				if ("Notification" in window) {
					const perm = await Notification.requestPermission();
					settings.notificationsEnabled = perm === 'granted';
				} else {
					settings.notificationsEnabled = false;
					alert('Notifications are not supported in this browser.');
				}
			} else {
				settings.notificationsEnabled = false;
			}
			saveAll();
		});

		// Focus timer
		els.focusStartBtn.addEventListener('click', (e) => { e.preventDefault(); startFocus(); });
		els.focusPauseBtn.addEventListener('click', (e) => { e.preventDefault(); pauseFocus(); });
		els.focusResetBtn.addEventListener('click', (e) => { e.preventDefault(); resetFocus(); });
		els.focusWorkMin.addEventListener('change', () => { if (focus.phase === 'idle') resetFocus(); });
		els.focusBreakMin.addEventListener('change', () => { if (focus.phase === 'idle') resetFocus(); });
		els.focusTaskSelect.addEventListener('change', () => { focus.taskId = els.focusTaskSelect.value || ""; saveAll(); });
	}

	function openEditDialog(id) {
		const t = tasks.find(t => t.id === id);
		if (!t) return;
		els.editTaskId.value = t.id;
		els.editTaskTitle.value = t.title;
		els.editTaskSubject.value = t.subject || "";
		els.editTaskDueDate.value = t.dueDate || "";
		els.editTaskDueTime.value = t.dueTime || "";
		els.editTaskDuration.value = String(t.durationHours || 0);
		els.editTaskPriority.value = t.priority || 'medium';
		els.editTaskReminderMinutes.value = String(t.reminderMinutes || 0);
		els.editTaskGoalLink.value = t.goalId || "";
		els.editTaskNotes.value = t.notes || "";
		if (typeof els.editDialog.showModal === 'function') {
			els.editDialog.showModal();
		} else {
			alert('Dialog not supported in this browser.');
		}
	}

	// Init
	function init() {
		loadAll();
		applyTheme(settings.theme || 'dark');
		ensureTodayStats();
		els.notificationsToggle.checked = !!settings.notificationsEnabled;
		if (els.taskDueDate) els.taskDueDate.value = todayISO();
		refreshGoalLinkOptions();
		attachEvents();
		renderAll();
		rescheduleAllReminders();
	}

	document.addEventListener('DOMContentLoaded', init);
})(); 