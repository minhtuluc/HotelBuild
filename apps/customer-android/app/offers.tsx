/**
 * HB-277 — giá theo số đêm (như `/offers` của web): bảng hệ số theo số đêm trên bảng ga, bốn gói giá với số
 * đêm tối thiểu, có giảm theo số đêm hay không, điều kiện đổi ngày; điều khoản. Giá thật luôn ở bước tìm phòng.
 */
import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LOS_TIERS, PLAN_FACTS, chainPagesCopy, isPlanCode } from '@pinehill/content/chain-pages';
import { landingContent } from '@pinehill/content/landing-content';
import { Board, BoardRow } from '@pinehill/ui-native';
import { ct } from '../src/content/text';
import { Paragraphs, Section } from '../src/content/parts';
import { currentLocale } from '../src/i18n/locale';
import { theme } from '../src/theme';

export default function OffersScreen(): ReactElement {
  const locale = currentLocale();
  const copy = chainPagesCopy(locale).offers;
  const plans = landingContent(locale).farePlans;
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.chain.offers.title')}
      </Text>
      <Text style={theme.body}>{copy.summary}</Text>
      <Board title={ct('guest.chain.offers.losTitle')}>
        {LOS_TIERS.map((tier) => (
          <BoardRow
            key={tier.fromNights}
            label={
              tier.toNights === null
                ? ct('guest.chain.offers.losFrom', { from: tier.fromNights })
                : ct('guest.chain.offers.losRange', { from: tier.fromNights, to: tier.toNights })
            }
            value={ct('guest.chain.offers.losFactor', { factor: tier.factor })}
          />
        ))}
      </Board>
      <Text style={theme.muted}>{copy.losBody}</Text>
      <Section title={ct('guest.chain.offers.plansTitle')}>
        {plans.map((plan) => {
          const facts = isPlanCode(plan.code) ? PLAN_FACTS[plan.code] : null;
          return (
            <View key={plan.code} style={theme.card}>
              <Text style={theme.label}>{plan.code}</Text>
              <Text style={theme.sectionTitle}>{plan.name}</Text>
              <Text style={theme.body}>{plan.deposit}</Text>
              {facts === null ? null : (
                <>
                  <Text style={theme.muted}>
                    {ct('guest.chain.offers.minNights', { n: facts.minNights })}
                  </Text>
                  <Text style={theme.muted}>
                    {ct(
                      facts.losDiscount ? 'guest.chain.offers.losYes' : 'guest.chain.offers.losNo',
                    )}
                  </Text>
                  <Text style={theme.muted}>
                    {ct(
                      facts.reschedule === 'free'
                        ? 'guest.chain.offers.rescheduleFree'
                        : 'guest.chain.offers.rescheduleFee',
                    )}
                  </Text>
                </>
              )}
            </View>
          );
        })}
      </Section>
      <Section title={ct('guest.chain.offers.termsTitle')}>
        <Paragraphs lines={copy.terms} />
      </Section>
    </ScrollView>
  );
}
