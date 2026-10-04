import { useEffect, useState } from "react";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { SuggestInput } from "@/components/ui/suggest-input";
import {
	type AddressOption,
	loadSuburbs,
	matchSuburbs,
	type SuburbOption,
	searchAddresses,
} from "@/lib/address";
import { AU_STATES } from "../../shared/schemas";

export type AddressValue = { siteAddress: string; suburb: string; state: string; postcode: string };
type Key = keyof AddressValue;

/**
 * Site address, suburb, state and postcode. The address suggests full street addresses (Photon/OSM);
 * the suburb suggests from the bundled G-NAF list. Picking either fills the rest; nothing has to be picked.
 */
export function AddressFields({
	value,
	onChange,
	errors,
}: {
	value: AddressValue;
	onChange: (patch: Partial<AddressValue>) => void;
	errors: Partial<Record<Key, string>>;
}) {
	const [addressQuery, setAddressQuery] = useState("");
	const [addresses, setAddresses] = useState<AddressOption[]>([]);
	const [suburbQuery, setSuburbQuery] = useState("");
	const [suburbList, setSuburbList] = useState<SuburbOption[] | null>(null);

	const prefetchSuburbs = () => {
		if (!suburbList) loadSuburbs().then(setSuburbList, () => {});
	};

	// Search as the address is typed, 300ms after the last key; an older request is cancelled.
	useEffect(() => {
		const q = addressQuery.trim();
		if (q.length < 3 || !navigator.onLine) {
			setAddresses([]);
			return;
		}
		const ctrl = new AbortController();
		const timer = setTimeout(() => {
			searchAddresses(q, ctrl.signal).then(setAddresses, () => {
				if (!ctrl.signal.aborted) setAddresses([]);
			});
		}, 300);
		return () => {
			clearTimeout(timer);
			ctrl.abort();
		};
	}, [addressQuery]);

	const suburbs = suburbList ? matchSuburbs(suburbList, suburbQuery) : [];

	const a11y = (k: Key) => ({
		id: `pf-${k}`,
		"aria-invalid": Boolean(errors[k]),
		"aria-describedby": errors[k] ? `pf-${k}-error` : undefined,
	});

	return (
		<>
			<Field id="pf-siteAddress" label="Site address" error={errors.siteAddress}>
				<SuggestInput
					{...a11y("siteAddress")}
					value={value.siteAddress}
					autoComplete="off"
					placeholder="Start typing a street address"
					onFocus={prefetchSuburbs}
					onChange={(e) => {
						onChange({ siteAddress: e.target.value });
						setAddressQuery(e.target.value);
					}}
					options={addresses}
					getKey={(o) => o.label}
					renderOption={(o) => o.label}
					onPick={(o) => {
						onChange({
							siteAddress: o.siteAddress,
							suburb: o.suburb ?? value.suburb,
							state: o.state ?? value.state,
							postcode: o.postcode ?? value.postcode,
						});
						setAddresses([]);
						setAddressQuery("");
					}}
					footer="Suggestions © OpenStreetMap contributors"
				/>
			</Field>
			<div className="grid gap-4 sm:grid-cols-[1fr_6.5rem_7rem]">
				<Field id="pf-suburb" label="Suburb" error={errors.suburb}>
					<SuggestInput
						{...a11y("suburb")}
						value={value.suburb}
						autoComplete="off"
						onFocus={prefetchSuburbs}
						onChange={(e) => {
							onChange({ suburb: e.target.value });
							setSuburbQuery(e.target.value);
						}}
						options={suburbs}
						getKey={(s) => `${s.suburb}|${s.state}|${s.postcode}`}
						renderOption={(s) => (
							<span className="flex w-full justify-between gap-3">
								<span>{s.suburb}</span>
								<span className="label-mono text-muted-foreground">
									{s.state} {s.postcode}
								</span>
							</span>
						)}
						onPick={(s) => {
							onChange({ suburb: s.suburb, state: s.state, postcode: s.postcode });
							setSuburbQuery("");
						}}
						footer="Suburbs from G-NAF © Geoscape Australia"
					/>
				</Field>
				<div className="grid grid-cols-2 gap-4 sm:contents">
					<Field id="pf-state" label="State" error={errors.state}>
						<NativeSelect
							{...a11y("state")}
							value={value.state}
							onChange={(e) => onChange({ state: e.target.value })}
						>
							<option value="">—</option>
							{AU_STATES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field id="pf-postcode" label="Postcode" error={errors.postcode}>
						<Input
							{...a11y("postcode")}
							value={value.postcode}
							inputMode="numeric"
							maxLength={4}
							autoComplete="postal-code"
							onChange={(e) => onChange({ postcode: e.target.value })}
						/>
					</Field>
				</div>
			</div>
		</>
	);
}
