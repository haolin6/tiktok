import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const checks = [
  {
    name: "Node.js",
    commands: ["node"],
    args: ["-v"],
    required: true,
    hint: "Install Node.js 22 LTS or use a version manager."
  },
  {
    name: "npm",
    commands: ["npm"],
    args: ["-v"],
    required: true,
    hint: "npm should be bundled with Node.js."
  },
  {
    name: "MySQL CLI",
    commands: ["mysql", "/opt/homebrew/opt/mysql@8.0/bin/mysql"],
    args: ["--version"],
    required: false,
    hint: "Install MySQL 8 locally or use Docker Compose."
  },
  {
    name: "Redis CLI",
    commands: ["redis-cli", "/opt/homebrew/bin/redis-cli"],
    args: ["--version"],
    required: false,
    hint: "Install Redis locally or use Docker Compose."
  },
  {
    name: "Docker",
    commands: ["docker"],
    args: ["--version"],
    required: false,
    hint: "Install Docker Desktop if you want to run docker-compose.yml."
  }
];

function runCheck(check) {
  for (const command of check.commands) {
    try {
      const output = execFileSync(command, check.args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();

      return { ...check, ok: true, command, output };
    } catch {
      // Try the next candidate path.
    }
  }

  return { ...check, ok: false, command: "", output: "" };
}

const results = checks.map(runCheck);
const missingRequired = results.filter((result) => result.required && !result.ok);
const envExample = resolve(process.cwd(), ".env.example");
const envText = existsSync(envExample) ? readFileSync(envExample, "utf8") : "";
const requiredEnvKeys = [
  "API_PORT",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_DB"
];
const missingEnvKeys = requiredEnvKeys.filter((key) => !envText.includes(`${key}=`));

for (const result of results) {
  const status = result.ok ? "OK" : result.required ? "MISSING" : "OPTIONAL";
  const detail = result.ok ? `${result.output} (${result.command})` : result.hint;
  console.log(`${status.padEnd(8)} ${result.name.padEnd(12)} ${detail}`);
}

if (missingEnvKeys.length === 0) {
  console.log("OK       .env.example includes MySQL and Redis keys.");
} else {
  console.log(`MISSING  .env.example missing: ${missingEnvKeys.join(", ")}`);
}

if (missingRequired.length > 0 || missingEnvKeys.length > 0) {
  process.exitCode = 1;
}
