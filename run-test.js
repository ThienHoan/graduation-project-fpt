import { execSync } from 'child_process'
process.chdir('D:/wdp301-rbl-project-wdp_se18d08_group-6/backend')
const cmd = 'npx vitest run src/modules/chat/chat.auto-reply.spec.ts src/modules/chat/chat.service.spec.ts'
try {
  const out = execSync(cmd, { encoding: 'utf8', stdio: 'inherit', timeout: 300000 })
  console.log(out)
} catch (e) {
  console.error(e.message)
}
