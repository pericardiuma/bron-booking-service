# Резервное копирование и восстановление БД

## Создание резервной копии
1. Откройте терминал.
2. Выполните команду: `pg_dump -U postgres -d bron_bez_konfliktov -F c -f backup.dump`

## Восстановление
1. Создайте пустую базу данных: `createdb -U postgres bron_test`
2. Восстановите данные: `pg_restore -U postgres -d bron_test backup.dump`
3. Измените строку подключения в `.env` на новую базу и перезапустите сервер.