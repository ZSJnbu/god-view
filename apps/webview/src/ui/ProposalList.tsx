export function ProposalList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}): React.JSX.Element {
  if (items.length === 0) return <></>;
  return (
    <section>
      <h5>{title}</h5>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
