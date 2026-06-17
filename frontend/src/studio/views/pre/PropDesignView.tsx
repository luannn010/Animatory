import { GenerationStudio } from './GenerationStudio'

export function PropDesignView() {
  return <GenerationStudio kind="prop" stages={['rough', 'color', 'locked']} ratio="1 / 1" />
}
