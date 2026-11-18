import React from 'react';

interface ModelEditorProps {
    parameters: any;
    onParameterChange: (name: string, value: any) => void;
}

export const ProgressiveTaxEditor: React.FC<ModelEditorProps> = ({ parameters, onParameterChange }) => {
    const handleRateChange = (index: number, newRate: number) => {
        const newTaxBrackets = [...parameters.tax_brackets];
        newTaxBrackets[index].rate = newRate;
        onParameterChange('tax_brackets', newTaxBrackets);
    };

    return (
        <div>
            <h3>Tax Brackets</h3>
            {parameters.tax_brackets?.map((bracket: any, index: number) => (
                <div key={index} style={{ marginBottom: '10px' }}>
                    <span>Rate for income &gt; {bracket.min_income}: </span>
                    <input
                        type="number"
                        step="0.01"
                        value={bracket.rate}
                        onChange={e => handleRateChange(index, parseFloat(e.target.value))}
                    />
                </div>
            ))}
        </div>
    );
};

export const SimpleRateEditor: React.FC<ModelEditorProps> = ({ parameters, onParameterChange }) => {
    return (
        <div>
            <h3>Flat Tax Rate</h3>
            <div>
                <span>Rate: </span>
                <input
                    type="number"
                    step="0.01"
                    value={parameters.rate}
                    onChange={e => onParameterChange('rate', parseFloat(e.target.value))}
                />
            </div>
            <div>
                <span>Base: </span>
                <input
                    type="number"
                    value={parameters.base}
                    onChange={e => onParameterChange('base', parseFloat(e.target.value))}
                />
            </div>
        </div>
    );
};

export const FixedValueEditor: React.FC<ModelEditorProps> = ({ parameters, onParameterChange }) => {
    return (
        <div>
            <h3>Fixed Cost</h3>
            <div>
                <span>Amount: </span>
                <input
                    type="number"
                    value={parameters.amount}
                    onChange={e => onParameterChange('amount', parseFloat(e.target.value))}
                />
            </div>
        </div>
    );
};

export const PerCapitaEditor: React.FC<ModelEditorProps> = ({ parameters, onParameterChange }) => {
    return (
        <div>
            <h3>Per Capita Cost</h3>
            <div>
                <span>Cost per Person: </span>
                <input
                    type="number"
                    value={parameters.per_capita_cost}
                    onChange={e => onParameterChange('per_capita_cost', parseFloat(e.target.value))}
                />
            </div>
            <div>
                <span>Population: </span>
                <input
                    type="number"
                    value={parameters.population}
                    onChange={e => onParameterChange('population', parseFloat(e.target.value))}
                />
            </div>
        </div>
    );
};

export const ModelEditor: React.FC<{ modelType: string } & ModelEditorProps> = ({ modelType, ...props }) => {
    switch (modelType) {
        case 'progressive_tax':
            return <ProgressiveTaxEditor {...props} />;
        case 'flat_tax':
            return <SimpleRateEditor {...props} />;
        case 'fixed_cost':
            return <FixedValueEditor {...props} />;
        case 'per_capita':
            return <PerCapitaEditor {...props} />;
        default:
            return <div>No editor available for model type: {modelType}</div>;
    }
};
