# Разработка и сборка

## Подготовка Windows

Нужны Git, Node.js 24 LTS, pnpm **11.19.0**, Rust с `x86_64-pc-windows-msvc`, Visual Studio C++ Build Tools (Desktop development with C++), Windows SDK и Microsoft Edge WebView2. Системные компоненты описаны в [официальной инструкции Tauri](https://v2.tauri.app/start/prerequisites/).

Node/pnpm используются только для разработки. Rust обслуживает оболочку и файлы; интерфейс и рендер строятся из TypeScript.

```powershell
npm install --global pnpm@11.19.0
git clone https://github.com/AlexCodeHadjar/matvision-studio.git
cd matvision-studio
pnpm install --frozen-lockfile
pnpm test:fixtures
pnpm typecheck
pnpm lint
pnpm test
```

Приватный репозиторий требует авторизации GitHub. Не добавляйте токен в URL или файлы проекта. Версии закреплены lock-файлами; не обновляйте их случайно при подготовке окружения.

## Запуск

```powershell
pnpm tauri dev
```

Команда запускает Vite и настоящее Tauri-окно. Для проверки только интерфейса можно использовать `pnpm dev` и `http://127.0.0.1:1420`; системные файловые операции требуют нативного приложения. Установленной программе Vite не нужен.

## Release-сборка

```powershell
pnpm tauri build
```

Результаты:

- `src-tauri/target/release/matvision-studio.exe` — приложение;
- `src-tauri/target/release/bundle/nsis/` — Windows-установщик;
- лицензии из `docs/licenses/` включаются в поставку.

`pnpm build` собирает только frontend. Нативная release-сборка в CI не означает проверку изображения на пользовательском GPU.

`scripts/native-env.ps1` и `scripts/native-build.ps1` — необязательные помощники для прежнего локального Rust/MSVC/SDK toolchain. На обычной машине используйте стандартные команды выше. При использовании помощников передайте свой `-ToolchainRoot`; частный toolchain не включается в репозиторий.

## Структура

| Путь | Назначение |
| --- | --- |
| `src/ui`, `src/app` | React-интерфейс, состояние, ошибки |
| `src/products`, `src/geometry` | Размеры и объёмная/деформируемая геометрия |
| `src/materials`, `src/textures`, `src/color` | PBR-карты, принт, декодирование, цвет |
| `src/scene`, `src/camera` | Three.js, свет, камера, realtime-рендер |
| `src/photo` | Снимок сцены, запекание материалов, BVH и path tracer |
| `src/project`, `src/contracts.ts` | Формат v2, валидация, миграции, общие типы |
| `src/native`, `src-tauri/src` | Tauri IPC, Rust, чтение/запись и системные диалоги |
| `public` | Локальные карты Poly Haven и HDRI |
| `tests`, `src/**/*.test.ts` | Проверки и синтетические изображения |
| `docs` | Инструкции, реальные кадры, лицензии и отчёты |

## Проверки рендера

[TESTING.md](TESTING.md) описывает уровни проверки. Для браузерных тестов сначала выполните `pnpm exec playwright install chromium`. Исторические визуальные эталоны относятся к прежним версиям: не обновляйте их автоматически ради успешного теста.

Дополнительные скрипты `tests/realism-*.mjs`, `tests/quality-ui.mjs`, `tests/photo-smoke.mjs` сохраняют данные в `work/` и используют установленный Edge. `tests/native-quality.mjs` подключается к отдельному тестовому WebView2 на `http://127.0.0.1:9335`; ему нужен подготовленный тестовый проект из quality-ui. Не подключайте такой тест к пользовательскому сеансу с несохранённой работой.

Для изолированного нативного теста можно запустить **отдельную тестовую копию** EXE с `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9335`, выполнить `node tests/native-quality.mjs`, закрыть тестовую копию и удалить переменную. Обычный установленный запуск не включает этот порт. GPU выбирается конфигурацией приложения; фоторежим требует проверки на реальном железе.

## Ограничения и изменения

Не меняйте рисунок при замене карты материала. Не смешивайте sRGB-цвет с normal/roughness-данными. Не выдавайте заданные анимации за физику ткани. Новые поля проекта требуют миграций, а замена графической библиотеки — проверки реального принта и деформаций.

Логи не должны содержать изображения, токены и личные пути. Решения — в `DECISIONS.md`, текущая точка — в `WORK_STATUS.md`, план — в `ROADMAP.md`. Перед следующим этапом начинайте с них.
