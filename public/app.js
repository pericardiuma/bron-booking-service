
const $ = (selector) => document.querySelector(selector);

const resourcesBox = $('#resources');
const resourceSelect = $('#resourceId');
const bookingForm = $('#bookingForm');

let lastPayload = null;
let lastIdempotencyKey = null;
let cachedResources = [];

function authHeaders() {
  return {
    Authorization: `Bearer ${sessionStorage.getItem('accessToken') || ''}`
  };
}

function showMessage(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text || '';
}

function escapeText(value) {
  return String(value ?? '');
}

function formatDate(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function statusText(status) {
  return status === 'active' ? 'Активно' : 'Отменено';
}

function canCancel(booking) {
  return booking.status === 'active' &&
    new Date(booking.start_at).getTime() > Date.now();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('userRole');
    window.location.replace('/');
    throw new Error('Сессия завершена. Войдите снова.');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Ошибка запроса');
  }

  return data;
}

function addTextElement(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function makeButton(text, onClick, className = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

// ---------- Доступные ресурсы ----------

async function loadResources() {
  showMessage('#message', 'Загружаем ресурсы...');
  resourcesBox.replaceChildren();
  resourceSelect.replaceChildren();

  try {
    const data = await api('/api/resources');
    cachedResources = Array.isArray(data.resources) ? data.resources : [];

    if (!cachedResources.length) {
      showMessage('#message', 'Активных ресурсов пока нет.');
      return;
    }

    showMessage('#message', '');

    for (const resource of cachedResources) {
      const card = document.createElement('article');
      card.className = 'resource';

      addTextElement(card, 'h3', resource.name);
      addTextElement(
        card,
        'p',
        `${resource.location || 'Место не указано'} — ${
          resource.description || 'Описание отсутствует'
        }`,
        'muted'
      );

      resourcesBox.append(card);

      const option = document.createElement('option');
      option.value = resource.id;
      option.textContent = resource.name;
      resourceSelect.append(option);
    }

    // Список ресурсов для фильтра администратора.
    const filter = $('#adminResourceFilter');
    if (filter) {
      const oldValue = filter.value;
      filter.replaceChildren();

      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = 'Все ресурсы';
      filter.append(allOption);

      for (const resource of cachedResources) {
        const option = document.createElement('option');
        option.value = resource.id;
        option.textContent = resource.name;
        filter.append(option);
      }

      filter.value = oldValue;
    }
  } catch (error) {
    showMessage('#message', error.message);
  }
}

$('#loadResources').addEventListener('click', loadResources);

// ---------- Создание бронирования ----------

function moscowInputToIso(value) {
  if (!value) throw new Error('Заполни дату и время.');

  const date = new Date(`${value}:00+03:00`);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Проверь дату и время.');
  }

  return date.toISOString();
}

bookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('#bookingMessage', '');

  if (!sessionStorage.getItem('accessToken')) {
    window.location.replace('/');
    return;
  }

  let payload;

  try {
    payload = {
      resourceId: Number(resourceSelect.value),
      startAt: moscowInputToIso($('#startAt').value),
      endAt: moscowInputToIso($('#endAt').value),
      purpose: $('#purpose').value.trim()
    };

    if (!Number.isSafeInteger(payload.resourceId) || payload.resourceId < 1) {
      throw new Error('Выбери ресурс.');
    }

    if (new Date(payload.endAt) <= new Date(payload.startAt)) {
      throw new Error('Окончание должно быть позже начала.');
    }

    if (payload.purpose.length < 5 || payload.purpose.length > 300) {
      throw new Error('Причина должна содержать от 5 до 300 символов.');
    }
  } catch (error) {
    showMessage('#bookingMessage', error.message);
    return;
  }

  const normalized = JSON.stringify(payload);

  // При повторной отправке тех же данных используется тот же ключ.
  if (normalized !== lastPayload || !lastIdempotencyKey) {
    lastPayload = normalized;
    lastIdempotencyKey = crypto.randomUUID();
  }

  const button = bookingForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Отправляем...';

  try {
    const data = await api('/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': lastIdempotencyKey
      },
      body: normalized
    });

    const booking = data.booking || data;
    showMessage(
      '#bookingMessage',
      `Запрос выполнен. ID бронирования: ${booking.id ?? 'см. список ниже'}`
    );

    lastPayload = null;
    lastIdempotencyKey = null;
    bookingForm.reset();

    await loadMyBookings();
  } catch (error) {
    showMessage('#bookingMessage', error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Забронировать';
  }
});

// ---------- Мои бронирования ----------

async function cancelMyBooking(id) {
  const confirmed = window.confirm(
    `Отменить бронирование №${id}? Это действие нельзя отменить.`
  );

  if (!confirmed) return;

  try {
    await api(`/api/bookings/${id}/cancel`, { method: 'POST' });
    showMessage('#myBookingsMessage', `Бронирование №${id} отменено.`);
    await loadMyBookings();
  } catch (error) {
    showMessage('#myBookingsMessage', error.message);
  }
}

async function loadMyBookings() {
  const container = $('#myBookings');
  container.replaceChildren();
  showMessage('#myBookingsMessage', 'Загружаем бронирования...');

  try {
    const data = await api('/api/bookings/my');
    const bookings = Array.isArray(data.bookings) ? data.bookings : [];
    const filter = $('#myStatusFilter').value;

    const filtered = bookings.filter((booking) =>
      filter === 'all' || booking.status === filter
    );

    showMessage(
      '#myBookingsMessage',
      filtered.length ? `Найдено бронирований: ${filtered.length}` :
        'Бронирований с таким статусом нет.'
    );

    for (const booking of filtered) {
      const card = document.createElement('article');
      card.className = 'booking';

      addTextElement(card, 'h3', `${booking.resource_name} — №${booking.id}`);

      addTextElement(
        card,
        'p',
        `Начало: ${formatDate(booking.start_at)}\nОкончание: ${formatDate(booking.end_at)}`,
        'muted'
      );

      addTextElement(card, 'p', `Причина: ${booking.purpose || '—'}`);
      addTextElement(
        card,
        'p',
        `Статус: ${statusText(booking.status)}`,
        `status ${booking.status}`
      );

      if (booking.cancelled_at) {
        addTextElement(card, 'p', `Отменено: ${formatDate(booking.cancelled_at)}`, 'muted');
      }

      if (canCancel(booking)) {
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(
          makeButton('Отменить бронирование', () => cancelMyBooking(booking.id), 'danger')
        );
        card.append(actions);
      } else if (booking.status === 'active') {
        addTextElement(card, 'p', 'Отмена недоступна: бронирование уже началось или завершилось.', 'muted');
      }

      container.append(card);
    }
  } catch (error) {
    showMessage('#myBookingsMessage', error.message);
  }
}

$('#refreshMyBookings').addEventListener('click', loadMyBookings);
$('#myStatusFilter').addEventListener('change', loadMyBookings);

// ---------- Админ-панель ----------

async function loadAdminResources() {
  const container = $('#adminResources');
  container.replaceChildren();

  try {
    const data = await api('/api/admin/resources');
    const resources = Array.isArray(data.resources) ? data.resources : [];

    for (const resource of resources) {
      const card = document.createElement('article');
      card.className = 'admin-item';

      addTextElement(card, 'strong', resource.name);
      addTextElement(
        card,
        'p',
        `${resource.location || 'Место не указано'} · ${
          resource.is_active ? 'Активен' : 'Отключён'
        }`,
        'muted'
      );

      card.append(
        makeButton(
          resource.is_active ? 'Отключить' : 'Включить',
          async () => {
            try {
              await api(`/api/admin/resources/${resource.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !resource.is_active })
              });

              await loadAdminResources();
              await loadResources();
            } catch (error) {
              showMessage('#resourceMessage', error.message);
            }
          }
        )
      );

      container.append(card);
    }
  } catch (error) {
    showMessage('#resourceMessage', error.message);
  }
}

$('#resourceForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('#resourceMessage', '');

  try {
    const data = await api('/api/admin/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#resourceName').value.trim(),
        description: $('#resourceDescription').value.trim(),
        location: $('#resourceLocation').value.trim()
      })
    });

    showMessage('#resourceMessage', `Ресурс «${data.resource.name}» добавлен.`);
    $('#resourceForm').reset();

    await loadAdminResources();
    await loadResources();
  } catch (error) {
    showMessage('#resourceMessage', error.message);
  }
});

$('#refreshAdminResources').addEventListener('click', loadAdminResources);

async function loadAdminBookings() {
  const container = $('#adminBookings');
  container.replaceChildren();
  showMessage('#adminBookingsMessage', 'Загружаем бронирования...');

  const params = new URLSearchParams();
  const status = $('#adminStatusFilter').value;
  const resourceId = $('#adminResourceFilter').value;
  const dateFrom = $('#adminDateFrom').value;
  const dateTo = $('#adminDateTo').value;

  if (status) params.set('status', status);
  if (resourceId) params.set('resourceId', resourceId);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  try {
    const data = await api(`/api/admin/bookings?${params.toString()}`);
    const bookings = Array.isArray(data.bookings) ? data.bookings : [];

    showMessage(
      '#adminBookingsMessage',
      `Найдено бронирований: ${bookings.length}`
    );

    for (const booking of bookings) {
      const card = document.createElement('article');
      card.className = 'booking';

      addTextElement(card, 'h3', `${booking.resource_name} — №${booking.id}`);
      addTextElement(card, 'p', `Пользователь: ${booking.user_name || booking.user_id}`);
      addTextElement(
        card,
        'p',
        `${formatDate(booking.start_at)} — ${formatDate(booking.end_at)}`,
        'muted'
      );
      addTextElement(card, 'p', `Причина: ${booking.purpose || '—'}`);
      addTextElement(card, 'p', `Статус: ${statusText(booking.status)}`, `status ${booking.status}`);

      if (booking.cancellation_reason) {
        addTextElement(card, 'p', `Причина отмены: ${booking.cancellation_reason}`);
      }

      if (canCancel(booking)) {
        card.append(
          makeButton('Отменить с причиной', async () => {
            const reason = window.prompt(
              'Укажи причину отмены (от 5 до 300 символов):'
            );

            if (reason === null) return;

            if (reason.trim().length < 5 || reason.trim().length > 300) {
              window.alert('Причина должна содержать от 5 до 300 символов.');
              return;
            }

            try {
              await api(`/api/admin/bookings/${booking.id}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason.trim() })
              });

              showMessage('#adminBookingsMessage', `Бронирование №${booking.id} отменено.`);
              await loadAdminBookings();
              await loadAudit();
            } catch (error) {
              showMessage('#adminBookingsMessage', error.message);
            }
          }, 'danger')
        );
      }

      container.append(card);
    }
  } catch (error) {
    showMessage('#adminBookingsMessage', error.message);
  }
}

$('#refreshAdminBookings').addEventListener('click', loadAdminBookings);

async function loadAudit() {
  const container = $('#auditEvents');
  container.replaceChildren();
  showMessage('#auditMessage', 'Загружаем журнал...');

  try {
    const data = await api('/api/admin/audit');
    const events = Array.isArray(data.events) ? data.events : [];

    showMessage('#auditMessage', `Событий: ${events.length}`);

    for (const event of events) {
      const card = document.createElement('article');
      card.className = 'admin-item';

      addTextElement(card, 'strong', event.action);
      addTextElement(
        card,
        'p',
        `${formatDate(event.occurred_at)} · ${event.object_type} №${event.object_id}`,
        'muted'
      );
      addTextElement(card, 'p', `Исполнитель: ${event.actor_id || '—'}`);

      container.append(card);
    }
  } catch (error) {
    showMessage('#auditMessage', error.message);
  }
}

$('#refreshAudit').addEventListener('click', loadAudit);

// ---------- Запуск интерфейса ----------

$('#logoutButton').addEventListener('click', () => {
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('userRole');
  window.location.replace('/');
});

if (!sessionStorage.getItem('accessToken')) {
  window.location.replace('/');
} else {
  const isAdmin = sessionStorage.getItem('userRole') === 'admin';

  $('#roleLabel').textContent = isAdmin ? 'Администратор' : 'Пользователь';
  $('#adminPanel').classList.toggle('hidden', !isAdmin);

  loadResources();
  loadMyBookings();

  if (isAdmin) {
    loadAdminResources();
    loadAdminBookings();
    loadAudit();
  }
}
