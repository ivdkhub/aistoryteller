import { useState } from 'react';
import { useItems } from '../api.ts';
import { Select } from '../components/ui.tsx';
import { IdeasBoard } from '../components/IdeasBoard.tsx';

export function IdeasPage() {
  const accounts = useItems('account');
  const [accountId, setAccountId] = useState<string>('all');
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="grow">Idee</h1>
        <Select
          value={accountId}
          onChange={setAccountId}
          options={[['all', 'Tutti gli account'], ['', 'Senza account'], ...(accounts ?? []).map((a): [string, string] => [a.id, a.name || a.handle])]}
        />
      </header>
      <IdeasBoard
        filter={accountId === 'all' ? {} : { accountId }}
        defaults={accountId && accountId !== 'all' ? { accountId } : {}}
      />
    </div>
  );
}
