const {
    app,
    BrowserWindow,
    shell,
    dialog
} = require("electron");

const fs = require("fs");
const http = require("http");
const path = require("path");

const APP_NAME = "Paryx ClubHub";
const APP_PROTOCOL = "paryx";
const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 47831;

let mainWindow = null;
let localServer = null;
let pendingDeepLink = null;

const gotSingleInstanceLock =
    app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    app.quit();
}

function isDeepLink(value) {
    return (
        typeof value === "string" &&
        value.toLowerCase().startsWith(
            `${APP_PROTOCOL}://`
        )
    );
}

function findDeepLink(argv) {
    return (
        Array.isArray(argv)
            ? argv.find(isDeepLink)
            : null
    ) || null;
}

function getWebRoot() {
    return app.isPackaged
        ? path.join(
            process.resourcesPath,
            "web"
        )
        : path.join(
            __dirname,
            "web"
        );
}

function mimeType(filePath) {
    const extension =
        path.extname(filePath)
            .toLowerCase();

    const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".txt": "text/plain; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".pdf": "application/pdf"
    };

    return (
        types[extension] ||
        "application/octet-stream"
    );
}

function safeFilePath(webRoot, requestPath) {
    let decodedPath;

    try {
        decodedPath =
            decodeURIComponent(
                requestPath
            );
    } catch {
        return null;
    }

    if (
        decodedPath === "/" ||
        decodedPath === ""
    ) {
        decodedPath =
            "/apps/club/html/login.html";
    }

    const relativePath =
        decodedPath
            .replace(/^\/+/, "")
            .replace(/\//g, path.sep);

    const resolved =
        path.resolve(
            webRoot,
            relativePath
        );

    const rootWithSeparator =
        webRoot.endsWith(path.sep)
            ? webRoot
            : `${webRoot}${path.sep}`;

    if (
        resolved !== webRoot &&
        !resolved.startsWith(
            rootWithSeparator
        )
    ) {
        return null;
    }

    return resolved;
}

function startLocalServer() {
    return new Promise(
        (resolve, reject) => {
            const webRoot =
                path.resolve(
                    getWebRoot()
                );

            const expectedLogin =
                path.join(
                    webRoot,
                    "apps",
                    "club",
                    "html",
                    "login.html"
                );

            if (
                !fs.existsSync(
                    expectedLogin
                )
            ) {
                reject(
                    new Error(
                        `Paryx web assets are missing. Expected ${expectedLogin}`
                    )
                );

                return;
            }

            localServer =
                http.createServer(
                    (request, response) => {
                        if (
                            request.method !== "GET" &&
                            request.method !== "HEAD"
                        ) {
                            response.writeHead(
                                405,
                                {
                                    "Content-Type":
                                        "text/plain; charset=utf-8",
                                    "Cache-Control":
                                        "no-store"
                                }
                            );

                            response.end(
                                "Method not allowed."
                            );

                            return;
                        }

                        const requestUrl =
                            new URL(
                                request.url,
                                `http://${LOCAL_HOST}:${LOCAL_PORT}`
                            );

                        const filePath =
                            safeFilePath(
                                webRoot,
                                requestUrl.pathname
                            );

                        if (!filePath) {
                            response.writeHead(
                                403,
                                {
                                    "Content-Type":
                                        "text/plain; charset=utf-8",
                                    "Cache-Control":
                                        "no-store"
                                }
                            );

                            response.end(
                                "Forbidden."
                            );

                            return;
                        }

                        fs.stat(
                            filePath,
                            (
                                statError,
                                stats
                            ) => {
                                if (
                                    statError ||
                                    !stats.isFile()
                                ) {
                                    response.writeHead(
                                        404,
                                        {
                                            "Content-Type":
                                                "text/plain; charset=utf-8",
                                            "Cache-Control":
                                                "no-store"
                                        }
                                    );

                                    response.end(
                                        "Not found."
                                    );

                                    return;
                                }

                                response.writeHead(
                                    200,
                                    {
                                        "Content-Type":
                                            mimeType(
                                                filePath
                                            ),
                                        "Cache-Control":
                                            "no-cache, no-store, must-revalidate",
                                        "X-Content-Type-Options":
                                            "nosniff"
                                    }
                                );

                                if (
                                    request.method ===
                                    "HEAD"
                                ) {
                                    response.end();
                                    return;
                                }

                                const stream =
                                    fs.createReadStream(
                                        filePath
                                    );

                                stream.on(
                                    "error",
                                    () => {
                                        if (
                                            !response
                                                .headersSent
                                        ) {
                                            response.writeHead(
                                                500
                                            );
                                        }

                                        response.end();
                                    }
                                );

                                stream.pipe(
                                    response
                                );
                            }
                        );
                    }
                );

            localServer.once(
                "error",
                (error) => {
                    reject(
                        new Error(
                            `Paryx could not start its local desktop service on ${LOCAL_HOST}:${LOCAL_PORT}. ` +
                            `Close any other application using that port and try again. ${error.message}`
                        )
                    );
                }
            );

            localServer.listen(
                LOCAL_PORT,
                LOCAL_HOST,
                () => {
                    resolve();
                }
            );
        }
    );
}

function localOrigin() {
    return (
        `http://${LOCAL_HOST}:${LOCAL_PORT}`
    );
}

function isLocalAppUrl(value) {
    try {
        const url =
            new URL(value);

        return (
            url.protocol === "http:" &&
            url.hostname === LOCAL_HOST &&
            Number(url.port) ===
                LOCAL_PORT
        );
    } catch {
        return false;
    }
}

function deepLinkDestination(value) {
    let link;

    try {
        link =
            new URL(value);
    } catch {
        return (
            `${localOrigin()}/apps/club/html/login.html`
        );
    }

    if (
        link.protocol !==
            `${APP_PROTOCOL}:` ||
        link.hostname !==
            "auth"
    ) {
        return (
            `${localOrigin()}/apps/club/html/login.html`
        );
    }

    const flowByPath = {
        "/invite": "invite",
        "/recovery": "recovery",
        "/set-password": "invite"
    };

    const flow =
        flowByPath[
            link.pathname
        ];

    if (!flow) {
        return (
            `${localOrigin()}/apps/club/html/login.html`
        );
    }

    const destination =
        new URL(
            "/apps/club/html/set-password.html",
            localOrigin()
        );

    link.searchParams.forEach(
        (value, key) => {
            destination
                .searchParams
                .append(
                    key,
                    value
                );
        }
    );

    if (
        !destination
            .searchParams
            .has("type")
    ) {
        destination
            .searchParams
            .set(
                "type",
                flow
            );
    }

    destination.hash =
        link.hash;

    return destination.href;
}

async function handleDeepLink(value) {
    if (!isDeepLink(value)) {
        return;
    }

    if (
        !mainWindow ||
        mainWindow.isDestroyed()
    ) {
        pendingDeepLink =
            value;

        return;
    }

    await mainWindow.loadURL(
        deepLinkDestination(
            value
        )
    );

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
}

function openExternalSafely(value) {
    try {
        const url =
            new URL(value);

        if (
            ![
                "http:",
                "https:",
                "mailto:"
            ].includes(
                url.protocol
            )
        ) {
            return;
        }

        shell.openExternal(
            url.href
        );
    } catch {
        // Ignore malformed external URLs.
    }
}

function configureNavigation(window) {
    window.webContents.setWindowOpenHandler(
        ({ url }) => {
            if (
                isDeepLink(url)
            ) {
                handleDeepLink(
                    url
                );

                return {
                    action: "deny"
                };
            }

            if (
                !isLocalAppUrl(
                    url
                )
            ) {
                openExternalSafely(
                    url
                );

                return {
                    action: "deny"
                };
            }

            return {
                action: "deny"
            };
        }
    );

    window.webContents.on(
        "will-navigate",
        (
            event,
            url
        ) => {
            if (
                isLocalAppUrl(
                    url
                )
            ) {
                return;
            }

            event.preventDefault();

            if (
                isDeepLink(
                    url
                )
            ) {
                handleDeepLink(
                    url
                );

                return;
            }

            openExternalSafely(
                url
            );
        }
    );
}

async function createMainWindow() {
    mainWindow =
        new BrowserWindow({
            title:
                APP_NAME,
            width:
                1440,
            height:
                900,
            minWidth:
                960,
            minHeight:
                640,
            show:
                false,
            autoHideMenuBar:
                true,
            backgroundColor:
                "#f3f6f4",
            webPreferences: {
                preload:
                    path.join(
                        __dirname,
                        "preload.js"
                    ),
                contextIsolation:
                    true,
                nodeIntegration:
                    false,
                sandbox:
                    true,
                webSecurity:
                    true,
                spellcheck:
                    false
            }
        });

    const cameraSession = mainWindow.webContents.session;
    function isStockPage(url) {
        try { return isLocalAppUrl(url) && new URL(url).pathname === "/apps/club/html/stock.html"; }
        catch { return false; }
    }
    cameraSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
        return webContents === mainWindow?.webContents && permission === "media" &&
            details.mediaType === "video" && details.isMainFrame &&
            isStockPage(details.requestingUrl || webContents.getURL());
    });
    cameraSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
        if (webContents !== mainWindow?.webContents || permission !== "media" ||
            !isStockPage(details.requestingUrl) ||
            !details.mediaTypes?.length || details.mediaTypes.some(type => type !== "video")) {
            callback(false);
            return;
        }
        try {
            const result = await dialog.showMessageBox(mainWindow, {
                type: "question", title: "Stock barcode camera",
                message: "Allow Paryx to use your camera to scan a stock barcode?",
                buttons: ["Allow camera", "Cancel"], defaultId: 0, cancelId: 1
            });
            callback(result.response === 0);
        } catch { callback(false); }
    });

    configureNavigation(
        mainWindow
    );

    mainWindow.once(
        "ready-to-show",
        () => {
            mainWindow.show();
        }
    );

    mainWindow.on(
        "closed",
        () => {
            mainWindow =
                null;
        }
    );

    await mainWindow.loadURL(
        `${localOrigin()}/apps/club/html/login.html`
    );

    if (pendingDeepLink) {
        const link =
            pendingDeepLink;

        pendingDeepLink =
            null;

        await handleDeepLink(
            link
        );
    }
}

app.on(
    "second-instance",
    (
        _event,
        commandLine
    ) => {
        const deepLink =
            findDeepLink(
                commandLine
            );

        if (deepLink) {
            handleDeepLink(
                deepLink
            );
        } else if (
            mainWindow &&
            !mainWindow.isDestroyed()
        ) {
            if (
                mainWindow.isMinimized()
            ) {
                mainWindow.restore();
            }

            mainWindow.show();
            mainWindow.focus();
        }
    }
);

app.on(
    "open-url",
    (
        event,
        url
    ) => {
        event.preventDefault();

        if (
            isDeepLink(
                url
            )
        ) {
            handleDeepLink(
                url
            );
        }
    }
);

app.whenReady()
    .then(
        async () => {
            app.setName(
                APP_NAME
            );

            if (
                app.isPackaged
            ) {
                app.setAsDefaultProtocolClient(
                    APP_PROTOCOL,
                    process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
                );
            }

            const initialDeepLink =
                findDeepLink(
                    process.argv
                );

            if (
                initialDeepLink
            ) {
                pendingDeepLink =
                    initialDeepLink;
            }

            await startLocalServer();
            await createMainWindow();
        }
    )
    .catch(
        (error) => {
            console.error(
                "Paryx desktop startup failed:",
                error
            );

            dialog.showErrorBox("Paryx could not start", error.message);
            app.quit();
        }
    );

app.on(
    "window-all-closed",
    () => {
        app.quit();
    }
);

app.on(
    "before-quit",
    () => {
        if (localServer) {
            localServer.close();
            localServer =
                null;
        }
    }
);
