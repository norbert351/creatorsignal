import { createMindsClient } from '@animocabrands/minds-client-lib'
const key = process.env.MINDS_BUILDER_API_KEY
const mindId = process.env.MIND_ID
const client = createMindsClient({ builderApiKey: key })
const skills = await client.listEquippedSkills(mindId)
console.log(`Equipped skills (${skills.length}):`)
for (const x of skills) console.log(`  - ${x.name} | source: ${x.source}`)
const found = skills.find((x) => /creatorsignal/i.test(x.name))
console.log(found ? `\nCreatorSignal skill EQUIPPED: ${found.name}` : '\nNo CreatorSignal skill equipped yet.')