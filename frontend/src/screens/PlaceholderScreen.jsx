export default function PlaceholderScreen({ name }) {
  return (
    <div className="border border-line bg-surface p-8">
      <h1 className="font-display text-display-md font-semibold text-ink">{name}</h1>
      <p className="mt-2 max-w-prose text-small text-ink-soft">
        This screen has no functionality yet. It will be built out in its corresponding
        development phase.
      </p>
    </div>
  )
}
