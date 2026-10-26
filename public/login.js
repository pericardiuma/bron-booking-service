
const loginForm = document.querySelector('#loginForm');
const loginInput = document.querySelector('#login');
const passwordInput = document.querySelector('#password');
const loginButton = document.querySelector('#loginButton');
const loginMessage = document.querySelector('#loginMessage');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginMessage.textContent = '';
  loginButton.disabled = true;
  loginButton.textContent = 'Входим...';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: loginInput.value.trim().toLowerCase(),
        password: passwordInput.value
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message || 'Не удалось войти. Проверь логин и пароль.'
      );
    }

    if (!data.accessToken) {
      throw new Error('Сервер не вернул токен авторизации');
    }

    sessionStorage.setItem('accessToken', data.accessToken);
    sessionStorage.setItem('userRole', data.user.role);

    window.location.replace('/app');
  } catch (error) {
    loginMessage.textContent =
      error.message || 'Не удалось подключиться к серверу';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Войти';
  }
});
