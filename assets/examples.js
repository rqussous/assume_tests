/* Examples reproducing ASSUME unit tests (assume-framework/assume @ c325fdd).
 *
 * Each example:
 *   file, test, title  where it comes from and what it shows
 *   kind               'storage' | 'plant'
 *   unit               overrides of the test fixture
 *   opts               { initial_previous_power, execute }  execute = run execute_current_dispatch after every hour
 *   hour0              the test's datetime hour shown as hour 0 here (default 0), so the code panel links the right column
 *   markets            [name, product_type] in clearing order
 *   bids               one row per hour, one entry per market: volume, 'max' / '-max', null (no order),
 *                      or [volume, false] for an order that was not accepted
 *   availability       (plant) forecaster availability per hour
 *   checks             [hour, stage, key, expected, label, tol]
 *                      stage: 's' = before the first market, 'e' = after all markets, n = before market n, 'h' = hour value
 *                      keys:  storage disMin disMax chMin chMax rampDis rampCh exec socEnd offerN
 *                             plant   min max rampMin rampMax inflex flex op exec offerN
 * To add an example, append an object to the list below. */
(function () {
  const STORAGE_FIXTURE = {
    max_power_charge: -100, max_power_discharge: 100, min_power_charge: 0, min_power_discharge: 0,
    capacity: 1000, min_soc: 0, max_soc: 1, initial_soc: 0.5, efficiency_charge: 0.9, efficiency_discharge: 0.95,
    ramp_up_charge: -60, ramp_down_charge: -50, ramp_up_discharge: 60, ramp_down_discharge: 50,
  };
  const PLANT_FIXTURE = { max_power: 1000, min_power: 200, ramp_up: '', ramp_down: '', min_operating_time: 0, min_down_time: 0 };
  const TS = 'tests/test_storage.py', TP = 'tests/test_powerplant.py', TF = 'tests/test_flexable_strategies.py', TFS = 'tests/test_flexable_storage_strategies.py';
  const RAMP_UNIT = { ramp_down: 100, ramp_up: 200, min_operating_time: 3, min_down_time: 2, min_power: 50 };
  const EXEC_UNIT = { max_power: 700, min_power: 50, ramp_down: 100, ramp_up: 200, min_operating_time: 3, min_down_time: 2 };
  const series = (vals, exp, label) => ({ bids: vals.map(v => [v]), checks: exp.map((e, i) => [i, 'h', 'exec', e, label]) });

  const s1 = series(
    [0, 0, 0, 200, 200, 100, 0, 0, 100, 100, 0, 0, 100, 0, 200, 200, 200, 500, 600, 700, 700, 400, 300, 200],
    [0, 0, 0, 200, 200, 100, 0, 0, 100, 100, 50, 0, 0, 0, 200, 200, 200, 400, 600, 700, 700, 600, 500, 400],
    'outputs["energy"] after execute_current_dispatch');
  const s2 = series(
    [0, 0, 200, 0, 0, 0, 500, 750, 400, 20, 320, 200, 120, 20, 20, 220, 420, 720, 620, 520, 420, 720, 800, 700],
    [0, 0, 200, 100, 50, 0, 0, 200, 400, 300, 320, 220, 120, 50, 50, 220, 420, 620, 620, 520, 420, 620, 700, 700],
    'outputs["energy"] after execute_current_dispatch');

  window.ASSUME_EXAMPLES = [
    // ---------------------------------------------------------------- storage
    {
      id: 'storage-window', file: TS, test: 'test_calculate_operational_window', kind: 'storage',
      title: 'Operational window with energy and reserves',
      note: 'The storage sells 10 MW, then holds 50 MW negative and 30 MW positive reserve. The negative reserve forces a minimum discharge of 40 MW, so it can be delivered without switching to charging.',
      unit: {}, markets: [['EOM', 'energy'], ['CRM_neg', 'capacity_neg'], ['CRM_pos', 'capacity_pos']],
      bids: [[10, -50, 30]],
      checks: [
        [0, 's', 'disMin', 0, 'min_power_discharge[0] == 0'], [0, 's', 'disMax', 100, 'max_power_discharge[0] == 100'],
        [0, 's', 'chMin', 0, 'min_power_charge[0] == 0'], [0, 's', 'chMax', -100, 'max_power_charge[0] == -100'],
        [0, 'e', 'chMin', -40, 'min_power_charge[0] == -40'], [0, 'e', 'chMax', -60, 'max_power_charge[0] == -60'],
        [0, 'e', 'disMin', 40, 'min_power_discharge[0] == 40'], [0, 'e', 'disMax', 60, 'max_power_discharge[0] == 60'],
      ],
    },
    {
      id: 'storage-soc', file: TS, test: 'test_soc_constraint', kind: 'storage',
      title: 'Charging limited by a nearly full storage',
      note: 'Same commitments, but SOC is 0.95. Charging is cut to (0.95 − 1) · 1000 / 0.9 ≈ −55.6 MW by the remaining space.',
      unit: { initial_soc: 0.95 }, hour0: 1, markets: [['EOM', 'energy'], ['CRM_neg', 'capacity_neg'], ['CRM_pos', 'capacity_pos']],
      bids: [[10, -50, 30]],
      checks: [
        [0, 'e', 'disMin', 40, 'min_power_discharge[0] == 40'], [0, 'e', 'disMax', 60, 'max_power_discharge[0] == 60'],
        [0, 'e', 'chMin', -40, 'min_power_charge[0] == -40'], [0, 'e', 'chMax', -55.56, 'max_power_charge[0] ≈ -50 / efficiency_charge', 0.1],
      ],
    },
    {
      id: 'storage-feedback', file: TS, test: 'test_storage_feedback', kind: 'storage',
      title: 'Second market after half the power is sold',
      note: 'The first market accepts 50 MW of discharge. A second market for the same hour can only get the remaining 50 MW. The next hour starts with the full range again.',
      unit: {}, opts: { execute: true }, markets: [['EOM', 'energy'], ['Second market', 'energy']],
      bids: [[50, null], [null, null]],
      checks: [
        [0, 's', 'chMin', 0, 'min_power_charge[0] == 0'], [0, 's', 'chMax', -100, 'max_power_charge[0] == -100'],
        [0, 's', 'disMin', 0, 'min_power_discharge[0] == 0'], [0, 's', 'disMax', 100, 'max_power_discharge[0] == 100'],
        [0, 1, 'disMin', 0, 'min_power_discharge[0] == 0'], [0, 1, 'disMax', 50, 'max_power_discharge[0] == 50'],
        [1, 's', 'disMin', 0, 'min_power_discharge[0] == 0'], [1, 's', 'disMax', 100, 'max_power_discharge[0] == 100'],
      ],
    },
    {
      id: 'storage-ramping', file: TS, test: 'test_storage_ramping', kind: 'storage',
      title: 'Ramping between discharge and charge',
      note: 'Hour 0 discharges 60 MW and hour 1 charges 60 MW. The ramp limits decide how far the next hour can move in each direction.',
      unit: {}, markets: [['EOM', 'energy']],
      bids: [[60], [-60], [null]],
      checks: [
        [0, 's', 'rampDis', 60, 'calculate_ramp_discharge(0.5, 0, 100) == 60'], [0, 's', 'rampCh', -60, 'calculate_ramp_charge(0.5, 0, -100) == -60'],
        [1, 's', 'rampDis', 100, 'calculate_ramp_discharge(0.5, 60, 100) == 100'], [1, 's', 'rampCh', -60, 'calculate_ramp_charge(0.5, 60, -100) == -60'],
        [2, 's', 'rampDis', 60, 'calculate_ramp_discharge(0.5, -60, 100) == 60'], [2, 's', 'rampCh', -100, 'calculate_ramp_charge(0.5, -60, -100) == -100'],
      ],
    },
    {
      id: 'storage-exec-dis', file: TS, test: 'test_execute_dispatch · full discharge', kind: 'storage',
      title: 'Full discharge for one hour',
      note: 'Discharging 100 MW for one hour removes 100 / 0.95 MWh from the storage.',
      unit: {}, hour0: 1, opts: { execute: true }, markets: [['EOM', 'energy']], bids: [[100]],
      checks: [[0, 'h', 'exec', 100, 'dispatched_energy[0] == 100'], [0, 'h', 'socEnd', 0.394737, 'soc[end] == (500 − 100 / η_dis) / 1000', 0.0001]],
    },
    {
      id: 'storage-exec-ch', file: TS, test: 'test_execute_dispatch · full charge', kind: 'storage',
      title: 'Full charge for one hour',
      note: 'Charging 100 MW for one hour adds 100 · 0.9 MWh.',
      unit: {}, hour0: 1, opts: { execute: true }, markets: [['EOM', 'energy']], bids: [[-100]],
      checks: [[0, 'h', 'exec', -100, 'dispatched_energy[0] == -100'], [0, 'h', 'socEnd', 0.59, 'soc[end] == (500 + 100 · η_ch) / 1000', 0.0001]],
    },
    {
      id: 'storage-exec-socdis', file: TS, test: 'test_execute_dispatch · SOC limit when discharging', kind: 'storage',
      title: 'Discharge cut by an almost empty storage',
      note: 'At SOC 0.05 only 50 MWh are left, so execute_current_dispatch cuts the 100 MW order to 50 · 0.95 = 47.5 MW.',
      unit: { initial_soc: 0.05 }, hour0: 1, opts: { execute: true }, markets: [['EOM', 'energy']], bids: [[100]],
      checks: [[0, 'h', 'exec', 47.5, 'dispatched_energy[0] ≈ 50 · efficiency_discharge', 0.1]],
    },
    {
      id: 'storage-exec-soch', file: TS, test: 'test_execute_dispatch · SOC limit when charging', kind: 'storage',
      title: 'Charge cut by a full storage, then nothing in the next hour',
      note: 'At SOC 0.95 only 55.6 MW of charging fits. The storage is then full, so the next hour cannot charge at all.',
      unit: { initial_soc: 0.95 }, hour0: 1, opts: { execute: true }, markets: [['EOM', 'energy']], bids: [[-100], [-100]],
      checks: [
        [0, 'h', 'exec', -55.56, 'dispatched_energy[0] ≈ -50 / efficiency_charge', 0.1], [0, 'h', 'socEnd', 1, 'soc[end] ≈ max_soc', 0.001],
        [1, 'h', 'exec', 0, 'dispatched_energy[0] == 0'], [1, 'h', 'socEnd', 1, 'soc[end] ≈ max_soc', 0.001],
      ],
    },
    {
      id: 'storage-multi', file: TS, test: 'test_set_dispatch_plan_multi_hours', kind: 'storage',
      title: 'SOC over three hours of discharging',
      note: 'Each hour of 100 MW discharge lowers the SOC by 100 / 0.95 / 1000.',
      unit: {}, markets: [['EOM', 'energy']], bids: [[100], [100], [100]],
      checks: [[0, 'h', 'socEnd', 0.394737, 'soc[01:00]', 0.0001], [1, 'h', 'socEnd', 0.289474, 'soc[02:00]', 0.0001], [2, 'h', 'socEnd', 0.184211, 'soc[03:00]', 0.0001]],
    },
    {
      id: 'storage-crm-pos', file: TFS, test: 'test_flexable_pos_crm_storage', kind: 'storage',
      title: 'Positive reserve bid of a storage',
      note: 'StorageCapacityHeuristicBalancingPosStrategy bids calculate_ramp_discharge of the maximum discharge, which ramp_up_discharge limits to 60 MW.',
      unit: {}, markets: [['CRM_pos', 'capacity_pos']], bids: [['max']],
      checks: [[0, 'h', 'offer0', 60, 'bids[0]["volume"] == 60']],
    },
    {
      id: 'storage-crm-neg', file: TFS, test: 'test_flexable_neg_crm_storage', kind: 'storage',
      title: 'Negative reserve bid of a storage',
      note: 'StorageCapacityHeuristicBalancingNegStrategy bids abs(calculate_ramp_charge(...)), limited to 60 MW by ramp_up_charge. The tool stores negative reserve as a negative number, as the storage tests do.',
      unit: {}, markets: [['CRM_neg', 'capacity_neg']], bids: [['max']],
      checks: [[0, 'h', 'offer0', -60, 'bids[0]["volume"] == 60 (stored as −60)']],
    },
    // ---------------------------------------------------------------- power plant
    {
      id: 'plant-window', file: TP, test: 'test_calculate_operational_window', kind: 'plant',
      title: 'Operational window of an idle plant',
      note: 'Nothing is sold yet, so the plant can offer between min_power and max_power.',
      unit: {}, markets: [['EOM', 'energy']], bids: [[null]],
      checks: [[0, 's', 'min', 200, 'min_power[0] == 200'], [0, 's', 'max', 1000, 'max_power[0] == 1000']],
    },
    {
      id: 'plant-feedback', file: TP, test: 'test_powerplant_feedback', kind: 'plant',
      title: 'Second market after min_power is sold',
      note: 'Once 200 MW are sold the run requirement is met, so the second market needs no minimum and can get up to 800 MW.',
      unit: {}, markets: [['EOM', 'energy'], ['Second market', 'energy']], bids: [[200, null], [null, null]],
      checks: [
        [0, 's', 'min', 200, 'min_power[0] == 200'], [0, 's', 'max', 1000, 'max_power[0] == 1000'],
        [0, 1, 'min', 0, 'min_power[0] == 0'], [0, 1, 'max', 800, 'max_power[0] == 800'],
        [1, 's', 'min', 200, 'min_power[0] == 200'], [1, 's', 'max', 1000, 'max_power[0] == 1000'],
      ],
    },
    {
      id: 'plant-min-feedback', file: TP, test: 'test_powerplant_min_feedback', kind: 'plant',
      title: 'Two orders that together exceed min_power',
      note: 'After 100 MW the plant still needs 100 MW more to reach min_power. After another 200 MW it needs nothing more.',
      unit: {}, opts: { execute: true }, markets: [['Market A', 'energy'], ['Market B', 'energy']], bids: [[100, 200], [null, null]],
      checks: [
        [0, 's', 'min', 200, 'min_power[0] == 200'], [0, 's', 'max', 1000, 'max_power[0] == 1000'],
        [0, 1, 'min', 100, 'min_power[0] == 100'], [0, 1, 'max', 900, 'max_power[0] == 900'],
        [0, 'e', 'min', 0, 'min_power[0] == 0'], [0, 'e', 'max', 700, 'max_power[0] == 700'],
        [1, 's', 'min', 200, 'min_power[0] == 200'], [1, 's', 'max', 1000, 'max_power[0] == 1000'],
      ],
    },
    {
      id: 'plant-ramp-feedback', file: TP, test: 'test_powerplant_ramp_feedback', kind: 'plant',
      title: 'Order below min_power, then the next hour',
      note: 'Only 100 MW are accepted, below min_power. execute_current_dispatch raises it to 200 MW. The next hour starts with the full window.',
      unit: {}, opts: { execute: true }, markets: [['EOM', 'energy']], bids: [[100], [null]],
      checks: [
        [0, 'e', 'min', 100, 'min_power[0] == 100'], [0, 'e', 'max', 900, 'max_power[0] == 900'],
        [1, 's', 'min', 200, 'min_power[0] == 200'], [1, 's', 'max', 1000, 'max_power[0] == 1000'],
      ],
    },
    {
      id: 'plant-ramping', file: TP, test: 'test_powerplant_ramping', kind: 'plant',
      title: 'Ramp limits over three hours',
      note: 'ramp_up = 200 and ramp_down = 100. Starting from 100 MW the plant reaches 300 MW, then 500 MW, and each hour narrows the next window.',
      unit: RAMP_UNIT, opts: { initial_previous_power: 100 }, markets: [['EOM', 'energy']], bids: [[300], [500], [null]],
      checks: [
        [0, 's', 'min', 50, 'min_power[0] == 50'], [0, 's', 'max', 1000, 'max_power[0] == 1000'], [0, 'h', 'op', 3, 'op_time == 3'],
        [0, 's', 'rampMin', 50, 'calculate_ramp(op_time, 100, min_power) == 50'], [0, 's', 'rampMax', 300, 'calculate_ramp(op_time, 100, max_power) == 300'],
        [1, 's', 'min', 50, 'min_power[0] == 50'], [1, 's', 'max', 1000, 'max_power[0] == 1000'], [1, 'h', 'op', 1, 'op_time == 1'],
        [1, 's', 'rampMin', 200, 'calculate_ramp(op_time, 300, min_power) == 200'], [1, 's', 'rampMax', 500, 'calculate_ramp(op_time, 300, max_power) == 500'],
        [2, 'h', 'op', 2, 'op_time == 2'],
        [2, 's', 'rampMin', 400, 'calculate_ramp(op_time, 500, min_power) == 400'], [2, 's', 'rampMax', 700, 'calculate_ramp(op_time, 500, max_power) == 700'],
      ],
    },
    {
      id: 'plant-ramping-mdt', file: TP, test: 'test_powerplant_ramping · min_down_time', kind: 'plant',
      title: 'Restart blocked by min_down_time',
      note: 'The plant was switched off in the previous hour. With min_down_time = 2 it must stay off, so every offer is cut to 0.',
      unit: RAMP_UNIT, opts: { initial_previous_power: 100 }, markets: [['EOM', 'energy']], bids: [[300], [0], [null]],
      checks: [
        [2, 'h', 'op', -1, 'op_time == -1'],
        [2, 's', 'rampMin', 0, 'calculate_ramp(op_time, 0, 0) == 0'], [2, 's', 'rampMax', 0, 'calculate_ramp(op_time, 0, 100) == 0'],
      ],
    },
    {
      id: 'plant-ramping-mot', file: TP, test: 'test_powerplant_ramping · min_operating_time', kind: 'plant',
      title: 'Shut-down blocked by min_operating_time',
      note: 'The plant only started in the previous hour. With min_operating_time = 3 it may not switch off, so even an offer of 0 becomes min_power.',
      unit: RAMP_UNIT, opts: { initial_previous_power: 100 }, markets: [['EOM', 'energy']], bids: [[0], [100], [null]],
      checks: [
        [2, 'h', 'op', 1, 'op_time == 1'],
        [2, 's', 'rampMin', 50, 'calculate_ramp(op_time, 100, 0) == 50'], [2, 's', 'rampMax', 300, 'calculate_ramp(op_time, 100, 1000) == 300'],
      ],
    },
    {
      id: 'plant-availability', file: TP, test: 'test_powerplant_availability', kind: 'plant',
      title: 'Changing availability',
      note: 'Availability is 0.5, 0.01, 1 and 1. At 0.01 only 10 MW are available, below min_power, so the plant cannot run that hour.',
      unit: { ramp_down: 1000, ramp_up: 1000 }, availability: [0.5, 0.01, 1, 1], markets: [['EOM', 'energy']], bids: [[null], [null], [null], [null]],
      checks: [
        [0, 's', 'rampMax', 500, 'max_ramp == max_power / 2'], [1, 's', 'rampMax', 0, 'max_ramp == 0'], [2, 's', 'rampMax', 1000, 'max_ramp == max_power'],
      ],
    },
    {
      id: 'plant-exec-1', file: TP, test: 'test_powerplant_execute_dispatch · single constraints', kind: 'plant',
      title: 'execute_current_dispatch fixing one constraint at a time',
      note: 'A 24-hour schedule that breaks min_operating_time (hour 10), min_down_time (hours 12–13), ramp_up (hour 17) and ramp_down (hours 21–23). Red markers show the corrected output.',
      unit: EXEC_UNIT, opts: { execute: true }, markets: [['Schedule', 'energy']], ...s1,
    },
    {
      id: 'plant-exec-2', file: TP, test: 'test_powerplant_execute_dispatch · combined constraints', kind: 'plant',
      title: 'execute_current_dispatch with combined constraints',
      note: 'The second schedule of the test, where several constraints are broken at once.',
      unit: EXEC_UNIT, opts: { execute: true }, markets: [['Schedule', 'energy']], ...s2,
    },
    {
      id: 'flex-eom', file: TF, test: 'test_flexable_eom', kind: 'plant',
      title: 'Inflexible and flexible EOM bid',
      note: 'EnergyHeuristicFlexableStrategy bids min_power as the inflexible part and the rest up to max_power as the flexible part.',
      unit: {}, markets: [['EOM', 'energy']], bids: [[null]],
      checks: [[0, 's', 'inflex', 200, 'bids[0]["volume"] == 200'], [0, 's', 'flex', 800, 'bids[1]["volume"] == 800']],
    },
    {
      id: 'flex-eom-ramp', file: TF, test: 'test_flexable_eom · start-up with ramp_up', kind: 'plant',
      title: 'EOM bid when starting up with ramp_up = 400',
      note: 'Starting from 0 MW the plant can only reach 400 MW, so the flexible part shrinks to 200 MW.',
      unit: { ramp_up: 400 }, markets: [['EOM', 'energy']], bids: [[null]],
      checks: [[0, 's', 'inflex', 200, 'bids[0]["volume"] == 200'], [0, 's', 'flex', 200, 'bids[1]["volume"] == 200']],
    },
    {
      id: 'flex-pos', file: TF, test: 'test_flexable_pos_reserve', kind: 'plant',
      title: 'Positive reserve bid of a plant',
      note: 'CapacityHeuristicBalancingPosStrategy bids calculate_ramp of max_power. Without ramp limits that is the full 1000 MW.',
      unit: {}, markets: [['CRM_pos', 'capacity_pos']], bids: [['max']],
      checks: [[0, 'h', 'offer0', 1000, 'bids[0]["volume"] == 1000']],
    },
    {
      id: 'flex-neg', file: TF, test: 'test_flexable_neg_reserve', kind: 'plant',
      title: 'Negative reserve bid after the plant was running',
      note: 'The negative reserve volume is previous_power − min_power. In hour 0 the plant was off, so nothing is bid. After running at 500 MW it can offer 300 MW.',
      unit: {}, markets: [['CRM_neg', 'capacity_neg'], ['EOM', 'energy']], bids: [['max', 500], ['max', null]],
      checks: [[0, 'h', 'offer0', 0, 'bids == []'], [1, 'h', 'offer0', 300, 'bids[0]["volume"] == 300']],
    },
  ];
  window.ASSUME_FIXTURES = { storage: STORAGE_FIXTURE, plant: PLANT_FIXTURE };
})();
