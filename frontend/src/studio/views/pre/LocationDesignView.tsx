import { GenerationStudio } from './GenerationStudio'

export function LocationDesignView() {
  return <GenerationStudio kind="location" stages={['rough', 'color', 'locked']} ratio="16 / 9" useTags />
}
