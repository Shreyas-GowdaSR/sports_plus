import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const children = [
  // The API always sits on 8787 behind Vite's /api proxy; PORT only moves the web app.
  spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: '8787' } }),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--configLoader', 'runner', '--port', process.env.PORT ?? '5173'], { cwd: root, stdio: 'inherit' }),
]

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  children.forEach((child) => { if (!child.killed) child.kill() })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
children.forEach((child) => {
  child.on('error', (error) => { console.error(error); shutdown(); process.exitCode = 1 })
  child.on('exit', (code) => { if (code && code !== 0) { shutdown(); process.exitCode = code } })
})
