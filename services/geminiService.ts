import { GoogleGenAI } from '@google/genai';
import { Equipment } from '../types';

const getGeminiClient = () => {
    // FIX: API key must be obtained from process.env.API_KEY per coding guidelines.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        // FIX: Updated error message to reflect the new source of the API key.
        throw new Error("A chave de API do Gemini não está configurada no ambiente (process.env.API_KEY).");
    }
    // FIX: Pass apiKey as a named parameter as required.
    return new GoogleGenAI({ apiKey });
}

export const generateReportWithGemini = async (query: string, data: Equipment[]): Promise<{ reportData?: Equipment[], error?: string }> => {
    try {
        const ai = getGeminiClient();
        const model = 'gemini-2.5-flash';
        
        const prompt = `
            Você é um assistente de IA especialista em análise de dados de inventário.
            Sua tarefa é filtrar uma lista de itens com base na solicitação do usuário e retornar os itens correspondentes.
            A data atual é ${new Date().toISOString().split('T')[0]}. Use esta data para cálculos de tempo se necessário.
            Analise a solicitação do usuário e os dados JSON do inventário fornecidos.
            Os nomes dos campos no JSON são: id, equipamento, garantia, patrimonio, serial, usuarioAtual, usuarioAnterior, local, setor, dataEntregaUsuario, status, dataDevolucao, tipo, notaCompra, notaPlKm, termoResponsabilidade, foto, qrCode.
            Retorne APENAS um array JSON contendo os objetos de equipamento que correspondem à solicitação.
            O array JSON de saída deve ser um subconjunto do array de entrada. Não altere a estrutura dos objetos.
            Se nenhum equipamento corresponder, retorne um array JSON vazio.

            Solicitação do usuário: "${query}"

            Dados do inventário (JSON):
            ${JSON.stringify(data, null, 2)}
        `;

        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
            }
        });
        
        // FIX: Per guidelines, access text directly from response.
        const jsonText = response.text;
        // FIX: It's good practice to handle cases where the text might not be perfectly trimmed or might be inside a code block.
        const cleanedJsonText = jsonText.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const reportData = JSON.parse(cleanedJsonText);


        if (!Array.isArray(reportData)) {
            throw new Error("A resposta da IA não era um array JSON.");
        }

        return { reportData };

    } catch (error: any) {
        console.error("Error calling Gemini API:", error);
        let errorMessage = "Ocorreu um erro ao gerar o relatório com a IA.";
        
        // FIX: Updated error handling to be more generic and align with new API key logic.
        if (error.message) {
             if (error.message.includes("API key not valid")) {
                errorMessage = "A chave de API do Gemini não é válida. Verifique a configuração do ambiente."
             } else if (error.message.includes("não está configurada")) {
                return { error: error.message };
            } else {
                errorMessage = `${errorMessage} Detalhes: ${error.message}`;
            }
        }

        return {
            error: errorMessage
        };
    }
};