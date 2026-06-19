import { GenerationStudio } from './GenerationStudio'

export function CharacterDesignView() {
  return <GenerationStudio kind="character" stages={['rough', 'color', 'locked']} ratio="3 / 4" useReference />
}
