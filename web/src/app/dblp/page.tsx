import type { Metadata } from 'next';
import DblpLoader from './DblpLoader';

export const metadata: Metadata = {
  title: 'Rede DBLP',
  description:
    'A rede de colaboração entre pesquisadores da Computação, reconstruída todo mês a partir do DBLP: escolha um ano, busque a rede, recorte-a ao redor de um pesquisador e no tamanho que quiser, abra no observatório ou exporte os arquivos no formato da disciplina.',
};

export default function DblpPage() {
  return <DblpLoader />;
}
