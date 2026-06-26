# WinSW-вариант — НЕ используется (запасной)

Стек запускается через **задачи Планировщика** (`ops\register-stack-tasks.ps1`,
задачи «LK Mstroy backends» / «LK Mstroy caddy»), а НЕ через WinSW-службы.
Причина: задачи бегут под `monit` с шифрованным паролем (DPAPI), без plaintext в .xml,
и tyagachi/Python берёт окружение пользователя.

Файлы `lk-admin.xml` / `lk-caddy.xml` / `install-services.ps1` оставлены как
альтернатива (настоящие службы SCM), если когда-нибудь понадобится. Перед использованием
скачать WinSW-x64.exe (см. install-services.ps1) и решить вопрос service-аккаунта.
