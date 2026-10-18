import { getCharacterPack } from '@pawoffice/assets-office/frame/resources'
import { resolveCharacterClip } from '@pawoffice/assets-office/frame/packSchema'
import { characterPoseClip, supportsOfficePose } from '@pawoffice/scene-office/core/poseSupport'
import type { PoseSupport } from '@pawoffice/runtime/actionContract'

export const supportsCharacterPose: PoseSupport = (id, posture, facing) => {
  const pack = getCharacterPack(id)
  return pack ? Boolean(resolveCharacterClip(pack.manifest, characterPoseClip(posture, facing))) : supportsOfficePose(id, posture, facing)
}
