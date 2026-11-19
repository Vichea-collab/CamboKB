import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useLang } from '../shared/lib/i18n';
import { t } from '../shared/lib/strings';
import { LanguageBoundary, LanguageToggle } from './LanguageToggle';

// Like the real pages: the text is read from `t` while this component renders.
function Line() {
  return <p>{t.cart.empty}</p>;
}

function Demo() {
  return (
    <LanguageBoundary>
      <LanguageToggle />
      <Line />
    </LanguageBoundary>
  );
}

beforeEach(() => {
  localStorage.clear();
  useLang.getState().setLang('en');
});

it('switches the whole page between English and Khmer', () => {
  render(<Demo />);
  expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Switch language to Khmer' }));
  expect(screen.getByText('កន្ត្រករបស់អ្នកទទេ។')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'ប្តូរភាសាទៅជាអង់គ្លេស' }));
  expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
});
