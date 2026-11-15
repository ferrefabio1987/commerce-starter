import path from "path"
import { loadEnv, defineConfig } from "@medusajs/framework/utils"

// Local development reads the single repo-root .env (see .env.example).
// In containers there is no .env file and real environment variables are used.
// Under Jest, jest.config.js has already loaded it (with test overrides).
if (process.env.NODE_ENV !== "test") {
  loadEnv(process.env.NODE_ENV || "development", path.resolve(__dirname, "../.."))
}

const env = process.env
const isProduction = env.NODE_ENV === "production"
const isWorker = env.MEDUSA_WORKER_MODE === "worker"

function assertEnv() {
  const required = ["DATABASE_URL"]
  if (!isWorker) {
    required.push("STORE_CORS", "ADMIN_CORS", "AUTH_CORS")
  }
  if (isProduction) {
    required.push("JWT_SECRET", "COOKIE_SECRET", "REDIS_URL")
  }
  const problems = required
    .filter((key) => !env[key])
    .map((key) => `${key} is not set`)
  if (isProduction) {
    for (const key of ["JWT_SECRET", "COOKIE_SECRET"]) {
      if (env[key] === "supersecret") {
        problems.push(`${key} uses the development default; generate one with: openssl rand -hex 32`)
      }
    }
  }
  if (problems.length) {
    throw new Error(
      `Invalid backend environment:\n  - ${problems.join("\n  - ")}\n` +
        "See .env.example for every variable and its purpose."
    )
  }
}

assertEnv()

const redisModules = env.REDIS_URL
  ? [
      {
        resolve: "@medusajs/medusa/event-bus-redis",
        options: { redisUrl: env.REDIS_URL },
      },
      {
        resolve: "@medusajs/medusa/workflow-engine-redis",
        options: { redis: { redisUrl: env.REDIS_URL } },
      },
      {
        resolve: "@medusajs/medusa/locking",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/locking-redis",
              id: "locking-redis",
              is_default: true,
              options: { redisUrl: env.REDIS_URL },
            },
          ],
        },
      },
    ]
  : []

// Without S3_BUCKET, the default local file provider stores uploads in ./static.
const fileModules = env.S3_BUCKET
  ? [
      {
        resolve: "@medusajs/medusa/file",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/file-s3",
              id: "s3",
              options: {
                file_url: env.S3_FILE_URL,
                access_key_id: env.S3_ACCESS_KEY_ID,
                secret_access_key: env.S3_SECRET_ACCESS_KEY,
                region: env.S3_REGION,
                bucket: env.S3_BUCKET,
                endpoint: env.S3_ENDPOINT,
                additional_client_config: {
                  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
                },
              },
            },
          ],
        },
      },
    ]
  : []

// The built-in system provider (pp_system_default) is always available for test checkouts.
const paymentModules = env.STRIPE_API_KEY
  ? [
      {
        resolve: "@medusajs/medusa/payment",
        options: {
          providers: [
            {
              resolve: "@medusajs/medusa/payment-stripe",
              id: "stripe",
              options: {
                apiKey: env.STRIPE_API_KEY,
                webhookSecret: env.STRIPE_WEBHOOK_SECRET,
              },
            },
          ],
        },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    workerMode: (env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server") || "shared",
    http: {
      storeCors: env.STORE_CORS!,
      adminCors: env.ADMIN_CORS!,
      authCors: env.AUTH_CORS!,
      jwtSecret: env.JWT_SECRET || "supersecret",
      cookieSecret: env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    disable: env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: env.MEDUSA_BACKEND_URL,
  },
  modules: [...redisModules, ...fileModules, ...paymentModules],
})
