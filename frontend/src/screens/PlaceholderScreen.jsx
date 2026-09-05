export default function PlaceholderScreen({ name }) {
  return (
    <>
      <h1 className="text-lg font-medium">{name}</h1>
      <p className="mt-2 max-w-prose text-sm text-neutral-600">
        This screen has no functionality yet. It will be built out in its corresponding
        development phase.
      </p>
    </>
  )
}
