import { scenePrimitives } from '@pawoffice/runtime'
import type { ScenePack } from '@pawoffice/runtime'
import { classroomObjects } from './objects.ts'
import { classroomTeaching } from './teaching.ts'
import { createClassroomWorld } from './world.ts'
export { classroomObjects, blackboardStateSchema } from './objects.ts'
export { classroomTeaching } from './teaching.ts'
export { createClassroomWorld, classroomRoster } from './world.ts'

export const classroomScenePack: ScenePack = {
  manifest: { id: 'pawoffice.classroom', version: '1.0.0', apiVersion: 1 },
  plugins: [scenePrimitives, classroomObjects, classroomTeaching],
  createWorld: createClassroomWorld,
  supportsPose: (_appearance, posture, facing) => posture === 'standing' || ['back', 'left', 'right'].includes(facing),
}
