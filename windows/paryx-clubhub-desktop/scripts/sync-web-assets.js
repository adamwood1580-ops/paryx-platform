const fs = require("fs");
const path = require("path");

const wrapperRoot =
    path.resolve(
        __dirname,
        ".."
    );

const repoRoot =
    path.resolve(
        wrapperRoot,
        "..",
        ".."
    );

const webRoot =
    path.join(
        wrapperRoot,
        "web"
    );

const sources = [
    {
        from:
            path.join(
                repoRoot,
                "apps"
            ),
        to:
            path.join(
                webRoot,
                "apps"
            )
    },
    {
        from:
            path.join(
                repoRoot,
                "shared"
            ),
        to:
            path.join(
                webRoot,
                "shared"
            )
    }
];

fs.rmSync(
    webRoot,
    {
        recursive:
            true,
        force:
            true
    }
);

fs.mkdirSync(
    webRoot,
    {
        recursive:
            true
    }
);

for (
    const source
    of sources
) {
    if (
        !fs.existsSync(
            source.from
        )
    ) {
        throw new Error(
            `Required Paryx source folder is missing: ${source.from}`
        );
    }

    fs.cpSync(
        source.from,
        source.to,
        {
            recursive:
                true
        }
    );
}

const loginPage =
    path.join(
        webRoot,
        "apps",
        "club",
        "html",
        "login.html"
    );

if (
    !fs.existsSync(
        loginPage
    )
) {
    throw new Error(
        "ClubHub login page was not copied into the desktop web bundle."
    );
}

console.log(
    `Paryx desktop web assets synced to ${webRoot}`
);

// Bundle the authentication SDK: starting ClubHub does not depend on a CDN.
const sdkSource = require.resolve("@supabase/supabase-js").replace(/dist[\\/]main[\\/]index\.js$/, "dist/umd/supabase.js");
const sdkTarget = path.join(webRoot, "apps", "club", "js", "vendor", "supabase.js");
if (!fs.existsSync(sdkSource)) throw new Error("The Supabase browser SDK is missing. Run npm install.");
fs.mkdirSync(path.dirname(sdkTarget), { recursive: true });
fs.copyFileSync(sdkSource, sdkTarget);
function localiseSdk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) localiseSdk(file);
        else if (/\.(html|js)$/.test(file) && file !== sdkTarget) {
            const source = fs.readFileSync(file, "utf8");
            const updated = source.replaceAll("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", "/apps/club/js/vendor/supabase.js");
            if (updated !== source) fs.writeFileSync(file, updated);
        }
    }
}
localiseSdk(webRoot);
