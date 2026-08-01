import { NextResponse } from 'next/server';
import { getSchemaProposals } from '@/lib/clickhouse';

export async function GET() {
  try {
    const proposals = await getSchemaProposals(50);
    return NextResponse.json(proposals);
  } catch (error) {
    console.error('Failed to fetch schema proposals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schema proposals' },
      { status: 500 }
    );
  }
}
